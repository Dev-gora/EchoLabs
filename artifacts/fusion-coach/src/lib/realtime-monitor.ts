/**
 * Realtime voice monitor.
 *
 * A TypeScript port of the personal-baseline monitor from the MultimodalCoach
 * reference project (`pipelines/audio/realtime_monitor.py`), translated to
 * English. The model is kept as-is:
 *
 *   1. The first 7 seconds are calibration. Speech blocks recorded there become
 *      the speaker's own baseline (mean and standard deviation of pitch and
 *      loudness).
 *   2. Every following 0.5-second block is scored as a z-score against that
 *      baseline. A block is a violation when |z| > 2.2.
 *   3. Silence runs longer than the pause threshold `tau` add their excess
 *      seconds to an overrun total.
 *   4. The three monitor scores decay exponentially with the violation ratio:
 *      S = 100 * exp(-3 * r), clipped to 0..100.
 *
 * What changed in the port: the reference reads the microphone with sounddevice,
 * detects speech with Silero VAD and extracts f0/loudness with openSMILE. This
 * app has no Python process, so speech decisions come from a per-frame energy
 * gate and pitch/loudness from autocorrelation on the analyser frame. Pitch is
 * reported in semitones above 27.5 Hz, the same scale openSMILE uses for
 * `f0semitoneFrom27.5Hz`, so the reference thresholds keep their meaning. All
 * three signals are compared only against the speaker's own baseline, so the
 * absolute scale of loudness does not affect the scores.
 *
 * Deliberately preserved quirk: in the reference, calibration pauses are
 * appended after `current_silence_sec` has already been reset by the speech
 * branch, so the calibration pause list is always empty and `tau` always falls
 * back to 1.0s. This port keeps that ordering so pause thresholds match the
 * source exactly.
 */

export const MONITOR_CONFIG = {
  /** Length of one analysis block, in seconds. */
  blockSeconds: 0.5,
  /** Length of the personal-baseline recording, in seconds. */
  calibrationSeconds: 7,
  /** Deviation above the baseline (in standard deviations) that counts as a violation. */
  zHigh: 2.2,
  /** Deviation below the baseline that counts as a violation. */
  zLow: 2.2,
  /** A silence shorter than this is not treated as a pause. */
  microPauseSeconds: 0.3,
  /** Multiplier applied to the baseline pause deviation to get `tau`. */
  pauseSigmaMultiplier: 2,
  /** Pause threshold used when calibration produced no pause samples. */
  fallbackPauseThreshold: 1,
  /** Share of a block that must be speech for the block to count as speech. */
  minSpeechRatio: 0.2,
  /** Minimum gap between two alerts of the same kind, in seconds. */
  alertCooldownSeconds: 3,
  /** Decay constant of the exponential score curve. */
  decay: 3,
  /** Analyser frame length, in samples. */
  frameSize: 2048,
  /** Lowest and highest pitch considered, in Hz. */
  minPitchHz: 70,
  maxPitchHz: 400,
  /** Normalised autocorrelation below which a frame is treated as unvoiced. */
  pitchConfidence: 0.45,
  /** RMS below which a frame is too quiet to report a pitch for. */
  pitchEnergyFloor: 0.0035,
} as const;

export type AlertKind = 'pause_long' | 'pitch_high' | 'pitch_low' | 'energy_high' | 'energy_low';

export type VoiceAlert = {
  kind: AlertKind;
  message: string;
  /** Seconds since the monitor started. */
  at: number;
};

/** English wording for the reference project's Korean popups. */
export const ALERT_MESSAGES: Record<AlertKind, string> = {
  pause_long: 'The silence is running long — pick the next sentence up.',
  pitch_high: 'Your pitch is above your range right now.',
  pitch_low: 'Your pitch has dropped below your range.',
  energy_high: 'Your volume is louder than your baseline.',
  energy_low: 'Your volume has fallen below your baseline.',
};

export type FrameFeatures = {
  /** Root-mean-square level of the frame, 0..1. */
  rms: number;
  /** Level in dBFS. */
  loudnessDb: number;
  /** Fundamental frequency in Hz, or null when the frame is unvoiced. */
  pitchHz: number | null;
  /** Pitch in semitones above 27.5 Hz, or null when unvoiced. */
  pitchSemitone: number | null;
};

/** One 0.5s block of aggregated frame features, the port's `process_chunk` input. */
export type BlockFeatures = {
  /** Speech share of the block, 0..1 (the reference's Silero speech ratio). */
  speechRatio: number;
  /** Median semitone pitch over voiced frames, or null when none were voiced. */
  pitchSemitone: number | null;
  /** Median loudness in dBFS over the block. */
  loudnessDb: number | null;
};

export type VoiceSummary = {
  /** Share of speech blocks whose pitch left the baseline. */
  pitchViolationRatio: number;
  /** Share of speech blocks whose loudness left the baseline. */
  energyViolationRatio: number;
  /** Excess pause seconds per second of evaluation time. */
  pauseExcessRatio: number;
  pitchScore: number;
  energyScore: number;
  pauseScore: number;
  /** Mean of the scores that actually have evidence behind them. */
  overallScore: number;
  /** Which monitors had blocks to measure. A missing monitor is not a 100. */
  measured: { pitch: boolean; energy: boolean; pause: boolean };
  /** Number of speech blocks used for the pitch and energy ratios. */
  speechBlocks: number;
  /** Seconds of evaluation time (excludes calibration). */
  evaluationSeconds: number;
};

export type MonitorSnapshot = {
  phase: 'idle' | 'calibrating' | 'monitoring' | 'stopped';
  /** Seconds consumed by calibration so far. */
  calibrationElapsed: number;
  /** Seconds still needed before evaluation starts. */
  calibrationRemaining: number;
  baseline: { pitchMean: number | null; pitchDeviation: number | null; energyMean: number | null; energyDeviation: number | null; pauseThreshold: number };
  /** Fraction of a block that has been accumulated. */
  blockProgress: number;
  summary: VoiceSummary;
  latestAlert: VoiceAlert | null;
};

const EMPTY_SUMMARY: VoiceSummary = {
  pitchViolationRatio: 0,
  energyViolationRatio: 0,
  pauseExcessRatio: 0,
  pitchScore: 0,
  energyScore: 0,
  pauseScore: 0,
  overallScore: 0,
  measured: { pitch: false, energy: false, pause: false },
  speechBlocks: 0,
  evaluationSeconds: 0,
};

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Rate the pitch search runs at, following the reference's 8 kHz pitch path. */
const PITCH_SAMPLE_RATE = 8000;

/**
 * Measures level and pitch for one analyser frame.
 *
 * Pitch uses a normalised autocorrelation on a decimated copy of the frame (the
 * reference also downsamples to 8 kHz before tracking pitch). Two guards keep it
 * honest: the search takes the shortest lag that comes within 90% of the best
 * correlation, which avoids reporting a sub-octave of the real fundamental, and
 * a parabolic fit around that lag refines the result below one sample.
 */
export function measureFrame(samples: Float32Array, sampleRate: number): FrameFeatures {
  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) mean += samples[index];
  mean /= Math.max(1, samples.length);

  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centred = samples[index] - mean;
    energy += centred * centred;
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  const loudnessDb = 20 * Math.log10(Math.max(rms, 1e-8));

  const decimation = Math.max(1, Math.round(sampleRate / PITCH_SAMPLE_RATE));
  const pitchRate = sampleRate / decimation;
  const length = Math.floor(samples.length / decimation);
  const decimated = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let value = 0;
    for (let offset = 0; offset < decimation; offset += 1) value += samples[index * decimation + offset] - mean;
    decimated[index] = value / decimation;
  }

  const minLag = Math.max(2, Math.floor(pitchRate / MONITOR_CONFIG.maxPitchHz));
  const maxLag = Math.min(length - 2, Math.floor(pitchRate / MONITOR_CONFIG.minPitchHz));

  if (maxLag <= minLag) {
    return { rms, loudnessDb, pitchHz: null, pitchSemitone: null };
  }

  const correlations = new Float32Array(maxLag + 2);
  let bestLag = 0;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index + lag < length; index += 1) {
      const left = decimated[index];
      const right = decimated[index + lag];
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const normalised = correlation / Math.sqrt(Math.max(leftEnergy * rightEnergy, 1e-12));
    correlations[lag] = normalised;
    if (normalised > bestCorrelation) {
      bestCorrelation = normalised;
      bestLag = lag;
    }
  }

  // Octave guard: a periodic signal correlates just as well at 2x, 3x or 4x its
  // period, and the global maximum can land on any of them. Walk upward from the
  // shortest lag and take the first genuine local maximum that comes within 90%
  // of the best correlation, which is the fundamental rather than a multiple.
  let chosenLag = bestLag;
  for (let lag = minLag; lag < bestLag; lag += 1) {
    const correlation = correlations[lag];
    if (correlation < bestCorrelation * 0.9) continue;
    if (correlation >= correlations[lag - 1] && correlation >= correlations[lag + 1]) {
      chosenLag = lag;
      break;
    }
  }

  const left = correlations[chosenLag - 1];
  const centre = correlations[chosenLag];
  const right = correlations[chosenLag + 1];
  const curvature = left - 2 * centre + right;
  const hasNeighbours = chosenLag > minLag && chosenLag < maxLag;
  const offset = hasNeighbours && curvature !== 0 ? (0.5 * (left - right)) / curvature : 0;
  const refinedLag = chosenLag + clamp(offset, -0.5, 0.5);

  // openSMILE reports 0 for unvoiced frames, which the reference drops; require
  // both a periodic window and a level that could plausibly be speech.
  const voiced =
    bestLag > 0 &&
    bestCorrelation >= MONITOR_CONFIG.pitchConfidence &&
    rms >= MONITOR_CONFIG.pitchEnergyFloor;
  const pitchHz = voiced ? pitchRate / refinedLag : null;

  return {
    rms,
    loudnessDb,
    pitchHz,
    pitchSemitone: pitchHz === null ? null : 12 * Math.log2(pitchHz / 27.5),
  };
}

/**
 * Port of `RealtimeSpeechMonitor`. Feed it analyser frames with `pushFrame`; it
 * aggregates them into 0.5s blocks and runs the reference model on each block.
 */
export class RealtimeVoiceMonitor {
  private phase: MonitorSnapshot['phase'] = 'idle';

  private calibrationDone = false;
  private processedSeconds = 0;

  private pitchCalibration: number[] = [];
  private energyCalibration: number[] = [];
  private pauseCalibration: number[] = [];

  private pitchMean = Number.NaN;
  private pitchDeviation = Number.NaN;
  private energyMean = Number.NaN;
  private energyDeviation = Number.NaN;
  private pauseThreshold: number = MONITOR_CONFIG.fallbackPauseThreshold;

  private currentSilenceSeconds = 0;
  private pitchBlocks = 0;
  private pitchViolations = 0;
  private energyBlocks = 0;
  private energyViolations = 0;
  private pauseExcessSeconds = 0;
  private evaluationSeconds = 0;

  private blockElapsed = 0;
  private blockFrames = 0;
  private blockSpeechFrames = 0;
  private blockPitches: number[] = [];
  private blockLoudness: number[] = [];
  private noiseFloor = 0.006;

  private lastAlertAt: Partial<Record<AlertKind, number>> = {};
  private latestAlert: VoiceAlert | null = null;

  constructor(private readonly clock: () => number = () => performance.now() / 1000) {}

  reset() {
    this.phase = 'idle';
    this.calibrationDone = false;
    this.processedSeconds = 0;
    this.pitchCalibration = [];
    this.energyCalibration = [];
    this.pauseCalibration = [];
    this.pitchMean = Number.NaN;
    this.pitchDeviation = Number.NaN;
    this.energyMean = Number.NaN;
    this.energyDeviation = Number.NaN;
    this.pauseThreshold = MONITOR_CONFIG.fallbackPauseThreshold;
    this.currentSilenceSeconds = 0;
    this.pitchBlocks = 0;
    this.pitchViolations = 0;
    this.energyBlocks = 0;
    this.energyViolations = 0;
    this.pauseExcessSeconds = 0;
    this.evaluationSeconds = 0;
    this.blockElapsed = 0;
    this.blockFrames = 0;
    this.blockSpeechFrames = 0;
    this.blockPitches = [];
    this.blockLoudness = [];
    this.noiseFloor = 0.006;
    this.lastAlertAt = {};
    this.latestAlert = null;
  }

  /** Begins a fresh calibration pass (the reference's `start`). */
  start() {
    this.reset();
    this.phase = 'calibrating';
  }

  stop() {
    if (this.phase !== 'idle') this.phase = 'stopped';
  }

  /**
   * Accepts one analyser frame. Returns the alerts the completed block raised
   * (usually none, at most one per monitor kind); the monitor keeps its own
   * cooldown per alert kind.
   */
  pushFrame(samples: Float32Array, sampleRate: number, seconds: number): VoiceAlert[] {
    if (this.phase !== 'calibrating' && this.phase !== 'monitoring') return [];

    const frame = measureFrame(samples, sampleRate);

    // Energy gate in place of Silero VAD: the noise floor drops quickly towards
    // quiet frames and creeps up slowly, so speech is anything clearly above it.
    if (frame.rms < this.noiseFloor) {
      this.noiseFloor = 0.85 * this.noiseFloor + 0.15 * frame.rms;
    } else {
      this.noiseFloor = Math.min(frame.rms, this.noiseFloor * 1.002 + 1e-6);
    }
    const isSpeechFrame = frame.rms > Math.max(this.noiseFloor * 2.2, 0.0035);

    this.blockElapsed += seconds;
    this.blockFrames += 1;
    if (isSpeechFrame) this.blockSpeechFrames += 1;
    if (frame.pitchSemitone !== null) this.blockPitches.push(frame.pitchSemitone);
    this.blockLoudness.push(frame.loudnessDb);

    if (this.blockElapsed < MONITOR_CONFIG.blockSeconds) return [];

    const block: BlockFeatures = {
      speechRatio: this.blockFrames ? this.blockSpeechFrames / this.blockFrames : 0,
      pitchSemitone: median(this.blockPitches),
      loudnessDb: median(this.blockLoudness),
    };

    this.blockElapsed = 0;
    this.blockFrames = 0;
    this.blockSpeechFrames = 0;
    this.blockPitches = [];
    this.blockLoudness = [];

    return this.processBlock(block);
  }

  /** Port of `process_chunk`. */
  private processBlock(block: BlockFeatures): VoiceAlert[] {
    const isSpeech = block.speechRatio >= MONITOR_CONFIG.minSpeechRatio;
    const raised: VoiceAlert[] = [];
    const collect = (alert: VoiceAlert | null) => {
      if (alert) raised.push(alert);
    };
    // The reference advances its processed clock for every block, in both phases.
    this.processedSeconds += MONITOR_CONFIG.blockSeconds;

    if (!this.calibrationDone) {
      if (isSpeech) {
        if (block.pitchSemitone !== null) this.pitchCalibration.push(block.pitchSemitone);
        if (block.loudnessDb !== null) this.energyCalibration.push(block.loudnessDb);
        this.currentSilenceSeconds = 0;
      } else {
        this.currentSilenceSeconds += MONITOR_CONFIG.blockSeconds;
      }

      // Kept in the reference's order on purpose: the speech branch above has
      // already reset the silence run, so this list stays empty and `tau` uses
      // the fallback exactly as the source does.
      if (isSpeech && this.currentSilenceSeconds >= MONITOR_CONFIG.microPauseSeconds) {
        this.pauseCalibration.push(this.currentSilenceSeconds);
        this.currentSilenceSeconds = 0;
      }

      if (this.processedSeconds >= MONITOR_CONFIG.calibrationSeconds) this.finalizeCalibration();
      return raised;
    }

    this.evaluationSeconds += MONITOR_CONFIG.blockSeconds;

    if (!isSpeech) {
      this.currentSilenceSeconds += MONITOR_CONFIG.blockSeconds;
      return raised;
    }

    if (this.currentSilenceSeconds > 0) {
      if (this.currentSilenceSeconds > this.pauseThreshold) {
        this.pauseExcessSeconds += this.currentSilenceSeconds - this.pauseThreshold;
        collect(this.raiseAlert('pause_long'));
      }
      this.currentSilenceSeconds = 0;
    }

    if (block.pitchSemitone !== null) {
      const zPitch = (block.pitchSemitone - this.pitchMean) / this.pitchDeviation;
      this.pitchBlocks += 1;
      if (zPitch > MONITOR_CONFIG.zHigh) {
        collect(this.raiseAlert('pitch_high'));
        this.pitchViolations += 1;
      } else if (zPitch < -MONITOR_CONFIG.zLow) {
        collect(this.raiseAlert('pitch_low'));
        this.pitchViolations += 1;
      }
    }

    if (block.loudnessDb !== null) {
      const zEnergy = (block.loudnessDb - this.energyMean) / this.energyDeviation;
      this.energyBlocks += 1;
      if (zEnergy > MONITOR_CONFIG.zHigh) {
        collect(this.raiseAlert('energy_high'));
        this.energyViolations += 1;
      } else if (zEnergy < -MONITOR_CONFIG.zLow) {
        collect(this.raiseAlert('energy_low'));
        this.energyViolations += 1;
      }
    }

    return raised;
  }

  private raiseAlert(kind: AlertKind): VoiceAlert | null {
    const now = this.clock();
    const previous = this.lastAlertAt[kind] ?? Number.NEGATIVE_INFINITY;
    if (now - previous < MONITOR_CONFIG.alertCooldownSeconds) return null;
    this.lastAlertAt[kind] = now;
    const alert: VoiceAlert = { kind, message: ALERT_MESSAGES[kind], at: this.processedSeconds };
    this.latestAlert = alert;
    return alert;
  }

  /** Port of `finalize_calibration`. */
  private finalizeCalibration() {
    if (this.pitchCalibration.length >= 3) {
      this.pitchMean = mean(this.pitchCalibration);
      this.pitchDeviation = deviation(this.pitchCalibration);
    } else {
      this.pitchMean = 0;
      this.pitchDeviation = 1;
    }

    if (this.energyCalibration.length >= 3) {
      this.energyMean = mean(this.energyCalibration);
      this.energyDeviation = deviation(this.energyCalibration);
    } else {
      this.energyMean = 0;
      this.energyDeviation = 1;
    }

    if (this.pauseCalibration.length >= 1) {
      this.pauseThreshold =
        mean(this.pauseCalibration) + MONITOR_CONFIG.pauseSigmaMultiplier * deviation(this.pauseCalibration);
    } else {
      this.pauseThreshold = MONITOR_CONFIG.fallbackPauseThreshold;
    }

    this.calibrationDone = true;
    this.phase = 'monitoring';
  }

  /** Port of `get_summary`. */
  getSummary(): VoiceSummary {
    const pitchRatio = this.pitchViolations / Math.max(1, this.pitchBlocks);
    const energyRatio = this.energyViolations / Math.max(1, this.energyBlocks);
    const pauseRatio = this.pauseExcessSeconds / Math.max(1e-6, this.evaluationSeconds);

    const pitchScore = clamp(100 * Math.exp(-MONITOR_CONFIG.decay * pitchRatio), 0, 100);
    const energyScore = clamp(100 * Math.exp(-MONITOR_CONFIG.decay * energyRatio), 0, 100);
    const pauseScore = clamp(100 * Math.exp(-MONITOR_CONFIG.decay * pauseRatio), 0, 100);

    const measured = {
      pitch: this.pitchBlocks > 0,
      energy: this.energyBlocks > 0,
      pause: this.evaluationSeconds > 0,
    };
    const scored = [
      measured.pitch ? pitchScore : null,
      measured.energy ? energyScore : null,
      measured.pause ? pauseScore : null,
    ].filter((value): value is number => value !== null);

    if (this.phase === 'idle') return { ...EMPTY_SUMMARY };

    return {
      pitchViolationRatio: pitchRatio,
      energyViolationRatio: energyRatio,
      pauseExcessRatio: pauseRatio,
      pitchScore,
      energyScore,
      pauseScore,
      overallScore: scored.length ? scored.reduce((total, value) => total + value, 0) / scored.length : 0,
      measured,
      speechBlocks: Math.max(this.pitchBlocks, this.energyBlocks),
      evaluationSeconds: this.evaluationSeconds,
    };
  }

  snapshot(): MonitorSnapshot {
    const baselineReady = this.calibrationDone;
    return {
      phase: this.phase,
      calibrationElapsed: Math.min(this.processedSeconds, MONITOR_CONFIG.calibrationSeconds),
      calibrationRemaining: Math.max(0, MONITOR_CONFIG.calibrationSeconds - this.processedSeconds),
      baseline: {
        pitchMean: baselineReady && this.pitchCalibration.length >= 3 ? this.pitchMean : null,
        pitchDeviation: baselineReady && this.pitchCalibration.length >= 3 ? this.pitchDeviation : null,
        energyMean: baselineReady && this.energyCalibration.length >= 3 ? this.energyMean : null,
        energyDeviation: baselineReady && this.energyCalibration.length >= 3 ? this.energyDeviation : null,
        pauseThreshold: this.pauseThreshold,
      },
      blockProgress: Math.min(1, this.blockElapsed / MONITOR_CONFIG.blockSeconds),
      summary: this.getSummary(),
      latestAlert: this.latestAlert,
    };
  }
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function deviation(values: number[]) {
  const average = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length) + 1e-8;
}

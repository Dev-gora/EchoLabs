/**
 * Unified scoring module combining Step 1 (deterministic metrics), Step 2 (acoustics),
 * and Step 3 (content scores). All weights/thresholds are named constants.
 */

import type { SpeechMetrics } from "./metrics.ts";
import type { ContentAnalysis } from "./content-analysis.ts";

export type AcousticFeatures = {
  pitch_variation_semitones: number | null;
  voiced_ratio: number | null;
  energy_variation_cv: number | null;
  silence_ratio: number | null;
  silence_intervals: Array<{ start: number; end: number }> | null;
};

export type UnifiedScores = {
  total: number | null;
  breakdown: {
    fluency: number | null;
    delivery: number | null;
    content: number | null;
  };
  details: Record<string, unknown>;
  trace: Array<{ component: string; value: number | null; basis: string }>;
};

// Named constants with comments
/** Target speaking pace band (WPM). */
export const PACE_TARGET_BAND = { min: 120, max: 160 } as const;
/** Smooth penalty factor for pace deviation. */
export const PACE_PENALTY_FACTOR = 0.015 as const;
/** Weight for fluency component. */
export const WEIGHT_FLUENCY = 0.4 as const;
/** Weight for delivery component. */
export const WEIGHT_DELIVERY = 0.3 as const;
/** Weight for content component. */
export const WEIGHT_CONTENT = 0.3 as const;
/** Fluency gating: heavy filler use caps total score. */
export const FILLER_GATING_THRESHOLD = 5 as const; // scored fillers
export const FILLER_GATING_MULTIPLIER = 0.85 as const;
/** Speech-to-pause ratio target. */
export const SPEECH_PAUSE_RATIO_TARGET = 4.0 as const;
/** Tempo stability smoothing decay. */
export const TEMPO_STABILITY_DECAY = 0.7 as const;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function paceScore(wpm: number | null): number | null {
  if (wpm === null || !Number.isFinite(wpm)) return null;
  if (wpm >= PACE_TARGET_BAND.min && wpm <= PACE_TARGET_BAND.max) {
    return 100;
  }
  if (wpm < PACE_TARGET_BAND.min) {
    const diff = PACE_TARGET_BAND.min - wpm;
    return clamp(100 - diff * PACE_PENALTY_FACTOR * 100, 0, 100);
  }
  const diff = wpm - PACE_TARGET_BAND.max;
  return clamp(100 - diff * PACE_PENALTY_FACTOR * 100, 0, 100);
}

function speechToPauseScore(metrics: SpeechMetrics): number | null {
  if (metrics.pauses && metrics.speaking_time_sec && metrics.duration_sec && metrics.duration_sec > 0) {
    const pauseTime = metrics.pauses.total_sec;
    if (pauseTime <= 0) return 95;
    const ratio = metrics.speaking_time_sec / pauseTime;
    if (ratio >= SPEECH_PAUSE_RATIO_TARGET) return 100;
    return clamp((ratio / SPEECH_PAUSE_RATIO_TARGET) * 100, 0, 100);
  }
  return null;
}

function tempoStabilityScore(metrics: SpeechMetrics, wordTimings?: readonly Array<{ start: number; end: number }> | null): number | null {
  // std of WPM across segments approximated from word timings if available
  if (wordTimings && wordTimings.length > 10) {
    // simple approximation: split into chunks
    const chunks = 5;
    const chunkSize = Math.floor(wordTimings.length / chunks);
    const wpms: number[] = [];
    for (let c = 0; c < chunks; c++) {
      const start = wordTimings[c * chunkSize];
      const end = wordTimings[Math.min((c + 1) * chunkSize - 1, wordTimings.length - 1)];
      const dur = end.end - start.start;
      if (dur > 0) {
        wpms.push((chunkSize / dur) * 60);
      }
    }
    if (wpms.length >= 2) {
      const mean = wpms.reduce((a, b) => a + b, 0) / wpms.length;
      const variance = wpms.reduce((a, b) => a + (b - mean) ** 2, 0) / wpms.length;
      const std = Math.sqrt(variance);
      // smooth decay
      const score = clamp(100 * Math.exp(-TEMPO_STABILITY_DECAY * (std / 20)), 0, 100);
      return round1(score);
    }
  }
  return null;
}

function fluencyScore(metrics: SpeechMetrics, wordTimings?: readonly Array<{ start: number; end: number }> | null): { score: number | null; trace: Array<{ component: string; value: number | null; basis: string }> } {
  const trace: Array<{ component: string; value: number | null; basis: string }> = [];
  let total = 0;
  let count = 0;

  const pScore = paceScore(metrics.wpm);
  if (pScore !== null) { total += pScore; count++; trace.push({ component: "pace", value: pScore, basis: `WPM=${metrics.wpm}, band ${PACE_TARGET_BAND.min}-${PACE_TARGET_BAND.max}` }); }

  const spScore = speechToPauseScore(metrics);
  if (spScore !== null) { total += spScore * 0.8; count += 0.8; trace.push({ component: "speech_to_pause", value: spScore, basis: "speech_time/pause_time ratio" }); }

  const tScore = tempoStabilityScore(metrics, wordTimings);
  if (tScore !== null) { total += tScore * 0.6; count += 0.6; trace.push({ component: "tempo_stability", value: tScore, basis: "std of WPM across segments (smooth decay)" }); }

  // fillers penalty
  const fillerCount = metrics.fillers?.scored ?? 0;
  if (fillerCount > 0) {
    const penalty = clamp(fillerCount * 3, 0, 30);
    if (count > 0) {
      // apply penalty to accumulated
      total = Math.max(0, total - penalty);
      trace.push({ component: "filler_penalty", value: -penalty, basis: `scored fillers=${fillerCount}` });
    }
  }

  const score = count > 0 ? clamp(total / count, 0, 100) : null;
  return { score: score === null ? null : round1(score), trace };
}

function deliveryScore(acoustics: AcousticFeatures | null | undefined): { score: number | null; trace: Array<{ component: string; value: number | null; basis: string }> } {
  const trace: Array<{ component: string; value: number | null; basis: string }> = [];
  if (!acoustics) return { score: null, trace };
  let total = 0;
  let count = 0;

  if (acoustics.energy_variation_cv !== null && Number.isFinite(acoustics.energy_variation_cv)) {
    // moderate variation is good
    const val = acoustics.energy_variation_cv;
    const s = val > 0.1 && val < 0.8 ? 100 : val <= 0.1 ? 60 : 80;
    total += s; count++;
    trace.push({ component: "energy_variation", value: s, basis: `CV=${val}` });
  }
  if (acoustics.pitch_variation_semitones !== null && Number.isFinite(acoustics.pitch_variation_semitones)) {
    const val = acoustics.pitch_variation_semitones;
    const s = val > 0.5 && val < 3 ? 100 : val <= 0.5 ? 50 : 90;
    total += s; count++;
    trace.push({ component: "pitch_variation_semitones", value: s, basis: `std(log f) in semitones=${val}` });
  }
  if (acoustics.voiced_ratio !== null && Number.isFinite(acoustics.voiced_ratio)) {
    const s = clamp(acoustics.voiced_ratio * 100, 0, 100);
    total += s; count++;
    trace.push({ component: "voiced_ratio", value: s, basis: `voiced_ratio=${acoustics.voiced_ratio}` });
  }
  if (acoustics.silence_ratio !== null && Number.isFinite(acoustics.silence_ratio)) {
    const s = clamp((1 - acoustics.silence_ratio) * 100, 0, 100);
    total += s; count++;
    trace.push({ component: "silence_ratio", value: s, basis: `silence_ratio=${acoustics.silence_ratio}` });
  }

  const score = count > 0 ? clamp(total / count, 0, 100) : null;
  return { score: score === null ? null : round1(score), trace };
}

function contentScore(content: ContentAnalysis | null | undefined): { score: number | null; trace: Array<{ component: string; value: number | null; basis: string }> } {
  const trace: Array<{ component: string; value: number | null; basis: string }> = [];
  if (!content || content.status === "unavailable") return { score: null, trace };
  const scores = content.scores;
  const vals = [scores.grammar, scores.vocabulary, scores.structure, scores.relevance].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return { score: null, trace };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const scaled = avg * 10; // 0-10 -> 0-100
  trace.push({ component: "content_avg", value: scaled, basis: `avg of grammar/vocab/structure/relevance (0-10) = ${avg}` });
  return { score: round1(clamp(scaled, 0, 100)), trace };
}

export function computeUnifiedScores(input: {
  metrics: SpeechMetrics;
  acoustics?: AcousticFeatures | null;
  content?: ContentAnalysis | null;
  words?: readonly Array<{ start: number; end: number }> | null;
}): UnifiedScores {
  const fluency = fluencyScore(input.metrics, input.words);
  const delivery = deliveryScore(input.acoustics);
  const content = contentScore(input.content);

  const trace = [...fluency.trace, ...delivery.trace, ...content.trace];

  let total: number | null = null;
  const parts: number[] = [];
  const weights: number[] = [];
  if (fluency.score !== null) { parts.push(fluency.score * WEIGHT_FLUENCY); weights.push(WEIGHT_FLUENCY); }
  if (delivery.score !== null) { parts.push(delivery.score * WEIGHT_DELIVERY); weights.push(WEIGHT_DELIVERY); }
  if (content.score !== null) { parts.push(content.score * WEIGHT_CONTENT); weights.push(WEIGHT_CONTENT); }

  if (parts.length > 0) {
    const wSum = weights.reduce((a, b) => a + b, 0);
    total = parts.reduce((a, b) => a + b, 0) / wSum;
    // fluency gating: heavy filler use caps total
    const fillerCount = input.metrics.fillers?.scored ?? 0;
    if (fillerCount >= FILLER_GATING_THRESHOLD) {
      total = Math.min(total, total * FILLER_GATING_MULTIPLIER);
      trace.push({ component: "fluency_gating", value: FILLER_GATING_MULTIPLIER, basis: `scored fillers>=${FILLER_GATING_THRESHOLD} caps total` });
    }
    total = round1(clamp(total, 0, 100));
  }

  return {
    total,
    breakdown: {
      fluency: fluency.score,
      delivery: delivery.score,
      content: content.score,
    },
    details: {
      filler_count_scored: input.metrics.fillers?.scored ?? 0,
      wpm: input.metrics.wpm,
      pauses_count: input.metrics.pauses?.count ?? null,
    },
    trace,
  };
}

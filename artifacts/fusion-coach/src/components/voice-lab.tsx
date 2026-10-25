import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileAudio, Loader2, Mic, RotateCcw, Square, Upload } from "lucide-react";

/**
 * Voice lab: record (or choose) a take, transcribe it with the local
 * faster-whisper service, edit the transcript, and re-score the text.
 *
 * Nothing here invents a number: every figure comes from the API, and a metric
 * that could not be measured arrives as null and is shown as "not measured".
 */

type WordTiming = { word: string; start: number; end: number };

type PauseReport = {
  threshold_sec: number;
  count: number;
  total_sec: number;
  average_sec: number;
  longest_sec: number;
};

type FillerReport = {
  scored: number;
  possible: number;
  scored_terms: Record<string, number>;
  possible_terms: Record<string, number>;
};

type SpeechMetrics = {
  word_count: number;
  duration_sec: number | null;
  wpm: number | null;
  articulation_rate: number | null;
  speaking_time_sec: number | null;
  pauses: PauseReport | null;
  fillers: FillerReport;
  lexical_diversity: number | null;
  sentence_count: number;
  average_sentence_words: number | null;
  used_word_timings: boolean;
};

type TranscribeResult = {
  transcript: string;
  words: WordTiming[];
  duration_sec: number;
  metrics: SpeechMetrics;
};

/** Mirrors the service's bounds so the UI can explain them before an upload. */
const MIN_SECONDS = 30;
const MAX_SECONDS = 180;
const MAX_BYTES = 12 * 1024 * 1024;

type Phase = "idle" | "recording" | "uploading" | "review";

function clock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function number(value: number | null, unit = "", places = 1): string {
  return value === null || !Number.isFinite(value) ? "not measured" : `${value.toFixed(places)}${unit}`;
}

export default function VoiceLab() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [transcript, setTranscript] = useState("");
  const [metrics, setMetrics] = useState<SpeechMetrics | null>(null);
  const [scoring, setScoring] = useState(false);
  const [sourceName, setSourceName] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => {
    clearTimer();
    recorderRef.current = null;
    stopTracks();
  }, []);

  const startRecording = async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not expose a microphone.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((candidate) =>
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate),
      );

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        stopTracks();
        if (blob.size > 0) {
          void upload(blob, `take.${type.includes("mp4") ? "m4a" : "webm"}`);
        }
      };

      recorderRef.current = recorder;
      recorder.start(500);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setPhase("recording");

      timerRef.current = window.setInterval(() => {
        const seconds = (Date.now() - startedAtRef.current) / 1000;
        setElapsed(seconds);
        // Never exceed the service ceiling: stop the take instead of letting it
        // fail after a long wait.
        if (seconds >= MAX_SECONDS) stopRecording();
      }, 200);
    } catch {
      setError("Microphone access was denied, so nothing could be recorded.");
      setPhase("idle");
    }
  };

  const stopRecording = () => {
    clearTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setPhase("uploading");
  };

  const upload = async (blob: Blob, filename: string) => {
    setPhase("uploading");
    setError(null);
    setResult(null);
    setMetrics(null);
    setSourceName(filename);

    if (blob.size > MAX_BYTES) {
      setError(`That file is larger than ${Math.round(MAX_BYTES / (1024 * 1024))} MiB.`);
      setPhase("idle");
      return;
    }

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": blob.type || "application/octet-stream",
          "X-Audio-Filename": filename,
        },
        body: blob,
      });

      const payload = (await response.json().catch(() => null)) as
        | (TranscribeResult & { error?: string; message?: string })
        | null;

      if (!response.ok || !payload || !("transcript" in payload)) {
        setError(
          payload?.message ??
            (response.status === 503
              ? "The transcription service is not running. Start it and try again."
              : "The recording could not be transcribed."),
        );
        setPhase("idle");
        return;
      }

      setResult({ transcript: payload.transcript, words: payload.words, duration_sec: payload.duration_sec, metrics: payload.metrics });
      setTranscript(payload.transcript);
      setMetrics(payload.metrics);
      setPhase("review");
    } catch {
      setError("The transcription request failed before it reached the server.");
      setPhase("idle");
    }
  };

  const onFileChosen = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    void upload(file, file.name);
  };

  const rescore = async () => {
    if (!result) return;

    const edited = transcript.trim() !== result.transcript.trim();
    setScoring(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          duration_sec: result.duration_sec,
          // Editing changes the words, so the original timings no longer
          // describe this text. Sending them would fake pauses and rhythm.
          words: edited ? undefined : result.words,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { metrics?: SpeechMetrics; message?: string }
        | null;

      if (!response.ok || !payload?.metrics) {
        setError(payload?.message ?? "The transcript could not be scored.");
        return;
      }

      setMetrics(payload.metrics);
    } catch {
      setError("The scoring request failed before it reached the server.");
    } finally {
      setScoring(false);
    }
  };

  const startOver = () => {
    clearTimer();
    stopTracks();
    setPhase("idle");
    setElapsed(0);
    setResult(null);
    setMetrics(null);
    setTranscript("");
    setError(null);
    setSourceName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const edited = result !== null && transcript.trim() !== result.transcript.trim();

  return (
    <section className="fc-workspace-view" aria-labelledby="voice-lab-title">
      <div className="fc-page-heading">
        <div>
          <div className="fc-kicker">Workspace / 05</div>
          <h1 id="voice-lab-title">Voice lab</h1>
          <p>Record a take, check the transcript, then score the words as written.</p>
        </div>
        <Mic size={22} color="#707b18" />
      </div>

      <div className="fc-card fc-lab">
        <div className="fc-card-head">
          <div>
            <h3 className="fc-card-title">1 · Record or choose audio</h3>
            <span className="fc-card-meta">
              {MIN_SECONDS}s–{MAX_SECONDS}s · transcribed on this machine
            </span>
          </div>
          <FileAudio size={17} color="#9ba0a7" />
        </div>

        <div className="fc-lab-controls">
          {phase === "recording" ? (
            <button className="fc-lab-record stop" onClick={stopRecording} data-testid="lab-stop">
              <Square size={15} /> Stop and transcribe
            </button>
          ) : (
            <button
              className="fc-lab-record"
              onClick={() => void startRecording()}
              disabled={phase === "uploading"}
              data-testid="lab-record"
            >
              <Mic size={15} /> Start recording
            </button>
          )}

          <span className={`fc-lab-clock ${phase === "recording" ? "live" : ""}`}>
            {clock(phase === "recording" ? elapsed : result?.duration_sec ?? 0)}
          </span>

          <label className="fc-lab-file">
            <Upload size={14} /> Choose a file
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.webm,.mp3,.m4a,.ogg,.flac"
              onChange={(event) => onFileChosen(event.target.files?.[0])}
              data-testid="lab-file"
            />
          </label>

          {(result || error) && (
            <button className="fc-lab-secondary" onClick={startOver} data-testid="lab-reset">
              <RotateCcw size={14} /> Start over
            </button>
          )}
        </div>

        {phase === "recording" && elapsed < MIN_SECONDS && (
          <p className="fc-lab-hint">
            {Math.max(0, Math.ceil(MIN_SECONDS - elapsed))}s more needed before the service will accept the take.
          </p>
        )}

        {phase === "uploading" && (
          <p className="fc-lab-status" data-testid="lab-uploading">
            <Loader2 size={14} className="fc-spin" /> Transcribing {sourceName || "audio"} — the first take loads the model, so it can be slow.
          </p>
        )}

        {error && (
          <p className="fc-lab-error" role="alert" data-testid="lab-error">
            <AlertTriangle size={14} /> {error}
          </p>
        )}
      </div>

      {result && (
        <div className="fc-card fc-lab">
          <div className="fc-card-head">
            <div>
              <h3 className="fc-card-title">2 · Check the transcript</h3>
              <span className="fc-card-meta">
                {result.words.length} words timed · {result.duration_sec.toFixed(1)}s of audio
                {edited ? " · edited, word timings dropped" : ""}
              </span>
            </div>
            <button className="fc-lab-primary" onClick={() => void rescore()} disabled={scoring || transcript.trim().length === 0} data-testid="lab-rescore">
              {scoring ? <Loader2 size={14} className="fc-spin" /> : null} {scoring ? "Scoring" : "Score this text"}
            </button>
          </div>

          <textarea
            className="fc-lab-transcript"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            rows={7}
            spellCheck={false}
            aria-label="Editable transcript"
            data-testid="lab-transcript"
          />

          <p className="fc-lab-hint">
            Fillers are kept in the transcript on purpose — they are the evidence. Editing the text removes pause and
            rhythm figures, because the original timings no longer describe your words.
          </p>
        </div>
      )}

      {metrics && (
        <div className="fc-card fc-lab" data-testid="lab-metrics">
          <div className="fc-card-head">
            <div>
              <h3 className="fc-card-title">3 · Deterministic metrics</h3>
              <span className="fc-card-meta">Computed from the text and the audio, no model involved</span>
            </div>
          </div>

          <div className="fc-lab-grid">
            <div>
              <span>Words</span>
              <b>{metrics.word_count}</b>
              <small>{metrics.sentence_count} sentence{metrics.sentence_count === 1 ? "" : "s"}</small>
            </div>
            <div>
              <span>Duration</span>
              <b>{number(metrics.duration_sec, "s")}</b>
              <small>true length of the take</small>
            </div>
            <div>
              <span>Pace</span>
              <b>{number(metrics.wpm)}</b>
              <small>wpm over the whole take</small>
            </div>
            <div>
              <span>Articulation rate</span>
              <b>{number(metrics.articulation_rate)}</b>
              <small>{metrics.speaking_time_sec === null ? "needs word timings" : `${metrics.speaking_time_sec.toFixed(1)}s speaking`}</small>
            </div>
          </div>

          <div className="fc-lab-block">
            <h4>Pauses</h4>
            {metrics.pauses ? (
              <div className="fc-lab-grid three">
                <div>
                  <span>Count</span>
                  <b>{metrics.pauses.count}</b>
                  <small>over {metrics.pauses.threshold_sec}s</small>
                </div>
                <div>
                  <span>Total</span>
                  <b>{metrics.pauses.total_sec.toFixed(2)}s</b>
                  <small>average {metrics.pauses.average_sec.toFixed(2)}s</small>
                </div>
                <div>
                  <span>Longest</span>
                  <b>{metrics.pauses.longest_sec.toFixed(2)}s</b>
                  <small>single gap</small>
                </div>
              </div>
            ) : (
              <p className="fc-lab-hint">
                Not measured — pauses come from gaps between words, and this text has no usable timings.
              </p>
            )}
          </div>

          <div className="fc-lab-block">
            <h4>Fillers</h4>
            <div className="fc-lab-fillers">
              <div>
                <b>{metrics.fillers.scored}</b>
                <span>scored</span>
                <div className="fc-lab-chips">
                  {Object.entries(metrics.fillers.scored_terms).map(([term, count]) => (
                    <i key={term}>
                      {term} ×{count}
                    </i>
                  ))}
                  {metrics.fillers.scored === 0 && <em>none found</em>}
                </div>
              </div>
              <div>
                <b>{metrics.fillers.possible}</b>
                <span>possible, not scored</span>
                <div className="fc-lab-chips muted">
                  {Object.entries(metrics.fillers.possible_terms).map(([term, count]) => (
                    <i key={term}>
                      {term} ×{count}
                    </i>
                  ))}
                  {metrics.fillers.possible === 0 && <em>none found</em>}
                </div>
              </div>
            </div>
            <p className="fc-lab-hint">
              "Like", "so", "right", "actually", "basically" and "literally" are reported separately: without meaning
              context the text cannot tell a filler from a real word.
            </p>
          </div>

          <div className="fc-lab-grid">
            <div>
              <span>Lexical diversity</span>
              <b>{number(metrics.lexical_diversity, "", 3)}</b>
              <small>type-token ratio, 50-word window</small>
            </div>
            <div>
              <span>Average sentence</span>
              <b>{number(metrics.average_sentence_words, " words")}</b>
              <small>{metrics.sentence_count} sentence{metrics.sentence_count === 1 ? "" : "s"}</small>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

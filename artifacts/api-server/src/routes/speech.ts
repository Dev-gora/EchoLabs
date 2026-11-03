import express, { Router, type IRouter } from "express";
import { computeSpeechMetrics, type WordTiming } from "../lib/metrics";
import { detectSpeechEvents } from "../lib/speech-events";
import { computeUnifiedScores, type AcousticFeatures as UnifiedAcousticFeatures } from "../lib/unified-scoring";
import { generateEventAwareFeedback } from "../lib/event-feedback";

/**
 * Speech endpoints for the post-recording flow:
 *
 *   POST /transcribe       raw audio body -> transcript + word timings
 *   POST /analyze/metrics  transcript (+ timings) -> deterministic metrics
 *
 * The transcription itself lives in `artifacts/asr-service` because
 * faster-whisper is Python. This router validates the upload, forwards it, and
 * owns the error envelope the client already knows.
 */

const router: IRouter = Router();

/** Same ceiling as the ASR service; checked here first so we fail fast. */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 12 * 1024 * 1024);

const ALLOWED_EXTENSIONS = new Set(["wav", "webm", "mp3", "m4a", "ogg", "flac"]);

const ALLOWED_CONTENT_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/webm",
  "video/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/flac",
  "application/octet-stream",
]);

const ASR_SERVICE_URL = process.env.ASR_SERVICE_URL ?? "http://127.0.0.1:8001";

/** Transcription is CPU bound; a cold model load can take tens of seconds. */
const ASR_TIMEOUT_MS = Number(process.env.ASR_TIMEOUT_MS ?? 120_000);

type AcousticFeatures = {
  pitch_variation_semitones: number | null;
  voiced_ratio: number | null;
  energy_variation_cv: number | null;
  silence_ratio: number | null;
  silence_intervals: Array<{ start: number; end: number }> | null;
};

type TranscribeResponse = {
  transcript: string;
  words: WordTiming[];
  duration_sec: number;
  acoustics: AcousticFeatures;
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function isAcousticFeatures(value: unknown): value is AcousticFeatures {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const nullableNumber = (entry: unknown) => entry === null || (typeof entry === "number" && Number.isFinite(entry));
  return (
    nullableNumber(item.pitch_variation_semitones) &&
    nullableNumber(item.voiced_ratio) &&
    nullableNumber(item.energy_variation_cv) &&
    nullableNumber(item.silence_ratio) &&
    (item.silence_intervals === null || Array.isArray(item.silence_intervals))
  );
}

function reject(res: express.Response, status: number, error: string, message: string) {
  res.status(status).json({ error, message });
}

router.post(
  "/transcribe",
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    const body = req.body as unknown;

    if (!Buffer.isBuffer(body) || body.length === 0) {
      reject(res, 400, "empty_upload", "Send the audio as the raw request body.");
      return;
    }

    if (body.length > MAX_UPLOAD_BYTES) {
      reject(
        res,
        413,
        "file_too_large",
        `The upload is larger than ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MiB.`,
      );
      return;
    }

    const filename = String(req.header("x-audio-filename") ?? "").trim();
    const extension = extensionOf(filename);

    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
      reject(
        res,
        400,
        "invalid_format",
        `Send X-Audio-Filename with one of: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
      );
      return;
    }

    const contentType = (req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();

    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      reject(res, 400, "invalid_format", `Unsupported content type '${contentType}'.`);
      return;
    }

    let upstream: Response;

    try {
      upstream = await fetch(`${ASR_SERVICE_URL}/transcribe`, {
        method: "POST",
        headers: {
          "content-type": contentType || "application/octet-stream",
          "x-audio-filename": filename,
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";

      reject(
        res,
        503,
        "asr_unavailable",
        timedOut
          ? "The transcription service took too long to answer."
          : "The transcription service is not reachable. Start it with `python artifacts/asr-service/app.py`.",
      );
      return;
    }

    const payload = (await upstream.json().catch(() => null)) as
      | (TranscribeResponse & { error?: string; message?: string })
      | { error?: string; message?: string }
      | null;

    if (!upstream.ok) {
      const error = payload && "error" in payload ? payload.error : undefined;
      const message = payload && "message" in payload ? payload.message : undefined;

      reject(
        res,
        upstream.status,
        error ?? "transcription_failed",
        message ?? "The transcription service could not process that recording.",
      );
      return;
    }

    if (
      !payload ||
      !("transcript" in payload) ||
      !("words" in payload) ||
      !("acoustics" in payload) ||
      !isAcousticFeatures(payload.acoustics)
    ) {
      reject(res, 502, "bad_upstream_response", "The transcription service returned an unexpected response.");
      return;
    }

    const metrics = computeSpeechMetrics({
      transcript: payload.transcript,
      words: payload.words,
      durationSec: payload.duration_sec,
    });

    res.json({
      transcript: payload.transcript,
      words: payload.words,
      duration_sec: payload.duration_sec,
      metrics,
      acoustics: payload.acoustics,
    });
  },
);

router.post("/analyze/metrics", (req, res) => {
  const body = (req.body ?? {}) as {
    transcript?: unknown;
    words?: unknown;
    duration_sec?: unknown;
  };

  if (typeof body.transcript !== "string" || body.transcript.trim().length === 0) {
    reject(res, 400, "invalid_request", "Expected a non-empty transcript to score.");
    return;
  }

  const duration =
    typeof body.duration_sec === "number" && Number.isFinite(body.duration_sec)
      ? body.duration_sec
      : null;

  if (duration !== null && (duration <= 0 || duration > 3_600)) {
    reject(res, 400, "invalid_request", "duration_sec must be between 0 and 3600.");
    return;
  }

  // Word timings are optional: an edited transcript keeps its words, but a
  // rewritten one arrives without them and the metric layer says so.
  const words = Array.isArray(body.words) ? (body.words as WordTiming[]) : null;

  res.json({
    metrics: computeSpeechMetrics({
      transcript: body.transcript,
      words,
      durationSec: duration,
    }),
  });
});

router.post("/analyze/events", (req, res) => {
  const body = (req.body ?? {}) as {
    transcript?: unknown;
    words?: unknown;
    duration_sec?: unknown;
    silence_intervals?: unknown;
  };

  if (typeof body.transcript !== "string" || body.transcript.trim().length === 0) {
    reject(res, 400, "invalid_request", "Expected a non-empty transcript.");
    return;
  }

  const words = Array.isArray(body.words) ? (body.words as WordTiming[]) : null;
  const duration = typeof body.duration_sec === "number" && Number.isFinite(body.duration_sec) ? body.duration_sec : null;
  const silenceIntervals = Array.isArray(body.silence_intervals) ? (body.silence_intervals as Array<{ start: number; end: number }>) : null;

  const events = detectSpeechEvents({ transcript: body.transcript, words, durationSec: duration, silenceIntervals });
  res.json({ events });
});

router.post("/analyze/unified", async (req, res) => {
  const body = (req.body ?? {}) as {
    transcript?: unknown;
    words?: unknown;
    duration_sec?: unknown;
    acoustics?: unknown;
    content_analysis?: unknown;
  };

  if (typeof body.transcript !== "string" || body.transcript.trim().length === 0) {
    reject(res, 400, "invalid_request", "Expected a non-empty transcript.");
    return;
  }

  const words = Array.isArray(body.words) ? (body.words as WordTiming[]) : null;
  const duration = typeof body.duration_sec === "number" && Number.isFinite(body.duration_sec) ? body.duration_sec : null;
  const metrics = computeSpeechMetrics({ transcript: body.transcript, words, durationSec: duration });
  const acoustics = body.acoustics && typeof body.acoustics === "object" ? (body.acoustics as UnifiedAcousticFeatures) : null;
  const content = body.content_analysis && typeof body.content_analysis === "object" ? (body.content_analysis as any) : null;

  const unified = computeUnifiedScores({ metrics, acoustics, content, words: words as any });
  const events = detectSpeechEvents({ transcript: body.transcript, words, durationSec: duration, silenceIntervals: acoustics?.silence_intervals ?? null });
  const feedback = await generateEventAwareFeedback({ scores: unified, events, metrics });

  res.json({ unified_scores: unified, events, event_feedback: feedback });
});

export default router;

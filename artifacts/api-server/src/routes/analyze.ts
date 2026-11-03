import { Router, type IRouter } from "express";
import {
  AnalyzeRecordingBody,
  GenerateIdealAnswerBody,
  RetryAnalysisBody,
  type AttemptSnapshot,
  type RetryResponse,
} from "@workspace/api-zod";
import {
  analyzeRecording,
  hasEnoughSpeech,
  type AnalysisResult,
} from "../lib/analysis";
import { getAnalysis, saveAnalysis } from "../lib/session-store";
import {
  analyzeContent,
  type AnalysisMode,
  type ContentAnalysis,
} from "../lib/content-analysis";

const router: IRouter = Router();

function snapshot(result: AnalysisResult): AttemptSnapshot {
  return {
    wpm: result.metrics.wpm,
    fillers: result.metrics.fillers,
    pauses: result.metrics.pauses,
    fluency_score: result.scores.fluency,
  };
}

function modeFrom(value: unknown): AnalysisMode {
  return value === "interview" || value === "debate" ? value : "general";
}

function scoreErrorContent(error: string): ContentAnalysis {
  return {
    status: "unavailable",
    scores: { grammar: null, vocabulary: null, structure: null, relevance: null },
    grammar_mistakes: [],
    strengths: [],
    weaknesses: [],
    suggestions: [],
    error,
  };
}

function signed(value: number, unit: string): string {
  if (value === 0) return `unchanged (${unit})`;

  return value > 0 ? `+${value} ${unit}` : `${value} ${unit}`;
}

router.post("/analyze", async (req, res) => {
  const parsed = AnalyzeRecordingBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: "Expected a transcript and the recording duration in seconds.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const result = analyzeRecording(parsed.data);

  if (!hasEnoughSpeech(result)) {
    res.status(422).json({
      error: "insufficient_speech",
      message: "Record at least a few full sentences before analyzing.",
      word_count: result.metrics.word_count,
    });
    return;
  }

  const mode = modeFrom(req.body?.mode);
  const promptText = typeof req.body?.prompt_text === "string" ? req.body.prompt_text : "";
  const content = await analyzeContent({
    transcript: parsed.data.transcript,
    prompt_text: promptText,
    mode,
  }).catch((error: unknown) => scoreErrorContent(
    error instanceof Error ? error.message : "Content scoring failed unexpectedly.",
  ));

  res.json(saveAnalysis({
    ...result,
    content_analysis: content,
    mode,
    prompt_text: promptText,
  } as typeof result));
});

router.post("/analyze/content", async (req, res) => {
  const transcript = req.body?.transcript;
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    res.status(400).json({ error: "invalid_request", message: "Expected a non-empty transcript." });
    return;
  }

  const result = await analyzeContent({
    transcript,
    prompt_text: typeof req.body?.prompt_text === "string" ? req.body.prompt_text : "",
    mode: modeFrom(req.body?.mode),
  }).catch((error: unknown) => scoreErrorContent(
    error instanceof Error ? error.message : "Content scoring failed unexpectedly.",
  ));
  res.json({ content_analysis: result });
});

router.post("/analyze/retry", async (req, res) => {
  const parsed = RetryAnalysisBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: "Expected a session_id, transcript and duration.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const previous = getAnalysis(parsed.data.session_id);

  if (!previous) {
    res.status(404).json({
      error: "not_found",
      message: "No earlier analysis exists for that session id.",
    });
    return;
  }

  const current = analyzeRecording({
    transcript: parsed.data.transcript,
    duration: parsed.data.duration,
    audio_url: previous.audio_url || undefined,
  });

  if (!hasEnoughSpeech(current)) {
    res.status(422).json({
      error: "insufficient_speech",
      message: "The retry needs at least a few full sentences to compare.",
      word_count: current.metrics.word_count,
    });
    return;
  }

  const originalAttempt = snapshot({
    ...current,
    metrics: previous.metrics,
    scores: previous.scores,
  });
  const currentAttempt = snapshot(current);

  const previousPromptText = typeof (previous as typeof previous & { prompt_text?: unknown }).prompt_text === "string"
    ? (previous as typeof previous & { prompt_text?: string }).prompt_text
    : "";
  const retryContent = await analyzeContent({
    transcript: parsed.data.transcript,
    prompt_text: previousPromptText || "",
    mode: modeFrom((previous as typeof previous & { mode?: unknown }).mode),
  }).catch((error: unknown) => scoreErrorContent(
    error instanceof Error ? error.message : "Content scoring failed unexpectedly.",
  ));
  const retry: Omit<RetryResponse, "session_id"> & { content_analysis: ContentAnalysis } = {
    ...current,
    content_analysis: retryContent,
    comparison: {
      original_attempt: originalAttempt,
      current_attempt: currentAttempt,
      improvements: {
        wpm: signed(
          Math.round((currentAttempt.wpm - originalAttempt.wpm) * 10) / 10,
          "wpm",
        ),
        fillers: signed(currentAttempt.fillers - originalAttempt.fillers, "fillers"),
        pauses: signed(currentAttempt.pauses - originalAttempt.pauses, "pauses"),
        fluency_score: signed(
          currentAttempt.fluency_score - originalAttempt.fluency_score,
          "points of fluency",
        ),
      },
    },
  };

  res.json(saveAnalysis(retry));
});

router.post("/analyze/ideal", (req, res) => {
  const parsed = GenerateIdealAnswerBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: "Expected a transcript and the prompt the answer responds to.",
    });
    return;
  }

  // Rewriting an answer into a model response needs a language model, and this
  // workspace has no provider configured. Say so instead of returning a
  // plausible-looking answer that no model produced.
  res.status(503).json({
    error: "llm_unavailable",
    message:
      "No language model provider is configured, so ideal answers cannot be generated yet.",
  });
});

router.get("/analyze/:id", (req, res) => {
  const session = getAnalysis(req.params.id);

  if (!session) {
    res.status(404).json({
      error: "not_found",
      message: "No analysis exists for that session id.",
    });
    return;
  }

  res.json(session);
});

export default router;

/**
 * Event-aware feedback: scores + top ~8 events go to LLM.
 * Rules: each metric gets 1-2 sentences with one concrete action item;
 * >=70 strengths, <60 lower-effort drill; events evidence only, no invented facts;
 * final note states limits; weighted top-3 priorities.
 * Use patterns from NOTES_FOR_LATER.md for exercises.
 * Robust JSON parsing with one retry; on failure return explicit error and keep numbers.
 */

import type { UnifiedScores } from "./unified-scoring.ts";
import type { SpeechEvent } from "./speech-events.ts";
import type { SpeechMetrics } from "./metrics.ts";

export type EventFeedback = {
  status: "available" | "unavailable";
  summary: string;
  per_metric: {
    fluency?: string;
    delivery?: string;
    content?: string;
  };
  priorities_top3: string[];
  exercises_from_patterns: string[];
  note: string;
  error?: string;
};

const FEEDBACK_TEMPERATURE = 0.25;
const REQUEST_TIMEOUT_MS = 30000;

function endpointUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function cleanJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function generateExercisesFromPatterns(metrics: SpeechMetrics): string[] {
  const exercises: string[] = [];
  const scoredFillers = metrics.fillers?.scored ?? 0;
  const topFillers = Object.entries(metrics.fillers?.scored_terms ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  if (scoredFillers > 0 && topFillers.length > 0) {
    exercises.push(`Silent-pause drill: replace "${topFillers[0]}" with a 1-second pause for 3 sentences.`);
  } else if (scoredFillers > 0) {
    exercises.push("Silent-pause drill: pause for 1 beat instead of using fillers for 5 sentences.");
  }

  const wpm = metrics.wpm;
  if (wpm !== null && wpm < 120) {
    exercises.push("Forward-voice/breathing drill: read a paragraph at comfortable pace focusing on steady exhalation.");
  } else if (wpm !== null && wpm > 160) {
    exercises.push("Deliberate slow-read: read 4-5 sentences at ~130 WPM, marking pauses with commas/periods.");
  } else if (wpm !== null && wpm >= 120 && wpm <= 160) {
    exercises.push("Pace-variation drill: vary pace intentionally (slow for key points, normal otherwise) across 3 sentences.");
  }

  exercises.push("No-filler intro: deliver a 10-second intro in front of a mirror with no scored fillers.");
  return exercises.slice(0, 4);
}

function weightedTop3Priorities(scores: UnifiedScores): string[] {
  const items = [
    { key: "fluency", val: scores.breakdown.fluency ?? 0, w: 1.15 },
    { key: "delivery", val: scores.breakdown.delivery ?? 0, w: 1.1 },
    { key: "content", val: scores.breakdown.content ?? 0, w: 1.05 },
  ];
  items.sort((a, b) => (a.val * a.w) - (b.val * b.w)); // lower score = higher priority
  return items.slice(0, 3).map((i) => i.key);
}

function buildPrompt(input: {
  scores: UnifiedScores;
  events: SpeechEvent[];
  metrics: SpeechMetrics;
}): string {
  const topEvents = input.events.slice(0, 8).map((e) => ({
    type: e.type,
    start: e.start,
    end: e.end,
    severity: e.severity,
    score: e.score,
    evidence: e.evidence,
    message: e.message,
  }));

  return `You are an event-aware speech coach. Analyze using ONLY the provided scores and timestamped events.

Rules:
- Each metric (fluency, delivery, content) gets 1-2 sentences with exactly one concrete action item.
- Scores >= 70 are framed as strengths. Scores < 60 get a lower-effort drill.
- Events are evidence ONLY. Never invent facts not present in events/scores.
- Include a final note stating the limits of the analysis (text/audio analysis limits).
- Prioritize by weighted importance (fluency > delivery > content).
- Be specific and honest; do not be uniformly generous.

Return JSON with exactly this shape:
{
  "summary": "2 sentences max",
  "per_metric": {
    "fluency": "...",
    "delivery": "...",
    "content": "..."
  },
  "priorities_top3": ["fluency", "delivery", "content"]
}

Scores: ${JSON.stringify(input.scores)}
Top events (evidence): ${JSON.stringify(topEvents)}
Metrics summary: wpm=${input.metrics.wpm}, fillers_scored=${input.metrics.fillers?.scored ?? 0}, pauses=${input.metrics.pauses?.count ?? 0}

Do not include filler counts you guess, confidence scores, or pace judgments not in the data.`;
}

export async function generateEventAwareFeedback(input: {
  scores: UnifiedScores;
  events: SpeechEvent[];
  metrics: SpeechMetrics;
}): Promise<EventFeedback> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    const priorities = weightedTop3Priorities(input.scores);
    return {
      status: "unavailable",
      summary: "Event-aware feedback unavailable (LLM_API_KEY missing). Numbers retained below.",
      per_metric: {},
      priorities_top3: priorities,
      exercises_from_patterns: generateExercisesFromPatterns(input.metrics),
      note: "Analysis limited to deterministic metrics, acoustics, and provided scores; LLM feedback not generated.",
      error: "LLM_API_KEY missing",
    };
  }

  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const prompt = buildPrompt(input);
  const priorities = weightedTop3Priorities(input.scores);

  let messages: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "user", content: prompt }];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpointUrl(baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: FEEDBACK_TEMPERATURE,
          response_format: { type: "json_object" },
          messages,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          status: "unavailable",
          summary: `Event-aware feedback unavailable (HTTP ${response.status}). Numbers retained below.`,
          per_metric: {},
          priorities_top3: priorities,
          exercises_from_patterns: generateExercisesFromPatterns(input.metrics),
          note: "Analysis limited to text/audio analysis constraints; feedback generation failed.",
          error: `HTTP ${response.status}`,
        };
      }
      const payload = await response.json() as any;
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("no content");
      const parsed = JSON.parse(cleanJson(content));
      const record = asRecord(parsed);
      return {
        status: "available",
        summary: typeof record.summary === "string" ? record.summary : "Event-aware feedback generated.",
        per_metric: {
          fluency: typeof (asRecord(record.per_metric)).fluency === "string" ? (asRecord(record.per_metric)).fluency as string : undefined,
          delivery: typeof (asRecord(record.per_metric)).delivery === "string" ? (asRecord(record.per_metric)).delivery as string : undefined,
          content: typeof (asRecord(record.per_metric)).content === "string" ? (asRecord(record.per_metric)).content as string : undefined,
        },
        priorities_top3: stringList(record.priorities_top3, 3).length > 0 ? stringList(record.priorities_top3, 3) : priorities,
        exercises_from_patterns: generateExercisesFromPatterns(input.metrics),
        note: typeof record.note === "string" ? record.note : "Analysis limited to deterministic metrics, acoustics, content scores, and timestamped events; no video/body-language features used.",
      };
    } catch (error) {
      if (attempt === 1) {
        return {
          status: "unavailable",
          summary: "Event-aware feedback unavailable (parsing failed after retry). Numbers retained below.",
          per_metric: {},
          priorities_top3: priorities,
          exercises_from_patterns: generateExercisesFromPatterns(input.metrics),
          note: "Analysis limited to deterministic metrics, acoustics, content scores, and timestamped events; feedback parsing failed.",
          error: error instanceof Error ? error.message : "parse_failed",
        };
      }
      messages = [
        { role: "user", content: prompt },
        { role: "assistant", content: typeof (error as any)?.message === "string" ? (error as any).message : "" },
        { role: "user", content: "Return valid JSON matching the exact schema with no markdown fences or commentary." },
      ];
    }
  }
  return {
    status: "unavailable",
    summary: "Event-aware feedback unavailable. Numbers retained below.",
    per_metric: {},
    priorities_top3: priorities,
    exercises_from_patterns: generateExercisesFromPatterns(input.metrics),
    note: "Analysis limited to deterministic metrics, acoustics, content scores, and timestamped events.",
    error: "unknown",
  };
}

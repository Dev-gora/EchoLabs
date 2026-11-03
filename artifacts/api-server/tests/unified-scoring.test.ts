import assert from "node:assert/strict";
import { test } from "node:test";
import { computeUnifiedScores } from "../src/lib/unified-scoring.ts";
import { generateEventAwareFeedback } from "../src/lib/event-feedback.ts";
import type { SpeechMetrics } from "../src/lib/metrics.ts";

function baseMetrics(fillers: number): SpeechMetrics {
  return {
    word_count: 100,
    duration_sec: 60,
    wpm: 140,
    articulation_rate: 150,
    speaking_time_sec: 50,
    pauses: { threshold_sec: 0.8, count: 2, total_sec: 2, average_sec: 1, longest_sec: 1.2 },
    fillers: {
      scored: fillers,
      possible: 0,
      scored_terms: fillers > 0 ? { um: fillers } : {},
      possible_terms: {},
    },
    lexical_diversity: 0.5,
    sentence_count: 5,
    average_sentence_words: 20,
    used_word_timings: true,
  };
}

test("scoring monotonicity: more fillers never raises the score", () => {
  const m1 = baseMetrics(0);
  const m2 = baseMetrics(3);
  const m3 = baseMetrics(10);
  const s1 = computeUnifiedScores({ metrics: m1 });
  const s2 = computeUnifiedScores({ metrics: m2 });
  const s3 = computeUnifiedScores({ metrics: m3 });
  assert.ok((s1.total ?? 100) >= (s2.total ?? 100));
  assert.ok((s2.total ?? 100) >= (s3.total ?? 100));
});

test("feedback normalization on failure returns explicit error and keeps numbers", async () => {
  const prevKey = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  const metrics = baseMetrics(2);
  const scores = computeUnifiedScores({ metrics });
  const feedback = await generateEventAwareFeedback({ scores, events: [], metrics });
  assert.equal(feedback.status, "unavailable");
  assert.ok(feedback.error);
  assert.ok(feedback.priorities_top3.length > 0);
  assert.ok(Array.isArray(feedback.exercises_from_patterns));
  if (prevKey) process.env.LLM_API_KEY = prevKey;
});

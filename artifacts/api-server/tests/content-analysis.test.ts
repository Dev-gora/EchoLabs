import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTENT_SCORE_KEYS,
  MAX_FEEDBACK_ITEMS,
  MAX_GRAMMAR_MISTAKES,
  buildContentPrompt,
  normalizeContentAnalysis,
  parseContentAnalysisJson,
} from "../src/lib/content-analysis.ts";

const transcript = "This is a useful answer with enough words to discuss the prompt and explain my point clearly and directly in more detail to reach over twenty words total.";
const full = {
  scores: { grammar: 7, vocabulary: 7, structure: 7, relevance: 7 },
  grammar_mistakes: [],
  strengths: [],
  weaknesses: [],
  suggestions: [],
};

test("normalizer parses fenced JSON", () => {
  const parsed = parseContentAnalysisJson(`\`\`\`json\n${JSON.stringify(full)}\n\`\`\``, transcript);
  assert.equal(parsed.status, "available");
  assert.deepEqual(parsed.scores, { grammar: 7, vocabulary: 7, structure: 7, relevance: 7 });
});

test("malformed JSON throws so caller can retry and report explicit failure", () => {
  assert.throws(() => parseContentAnalysisJson("{ not json", transcript), SyntaxError);
});

test("scores are clamped and rounded to the supported range", () => {
  const result = normalizeContentAnalysis({
    ...full,
    scores: { grammar: -8, vocabulary: 14.8, structure: 6.6, relevance: "9" },
  }, transcript);
  assert.deepEqual(result.scores, { grammar: 0, vocabulary: 10, structure: 7, relevance: 9 });
});

test("missing score keys remain null and analysis is partial", () => {
  const result = normalizeContentAnalysis({ scores: { grammar: 5 } }, transcript);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.scores, { grammar: 5, vocabulary: null, structure: null, relevance: null });
  assert.deepEqual(result.strengths, []);
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(Object.keys(result.scores), [...CONTENT_SCORE_KEYS]);
});

test("over-long arrays are capped and malformed entries removed", () => {
  const result = normalizeContentAnalysis({
    ...full,
    strengths: [...Array.from({ length: MAX_FEEDBACK_ITEMS + 4 }, (_, index) => `strength ${index}`), 7],
    weaknesses: Array.from({ length: MAX_FEEDBACK_ITEMS + 3 }, (_, index) => `weakness ${index}`),
    suggestions: Array.from({ length: MAX_FEEDBACK_ITEMS + 2 }, (_, index) => `suggestion ${index}`),
    grammar_mistakes: Array.from({ length: MAX_GRAMMAR_MISTAKES + 2 }, (_, index) => ({
      quote: "This is",
      correction: `This was ${index}`,
      explanation: "Tense",
    })),
  }, transcript);
  assert.equal(result.strengths.length, MAX_FEEDBACK_ITEMS);
  assert.equal(result.weaknesses.length, MAX_FEEDBACK_ITEMS);
  assert.equal(result.suggestions.length, MAX_FEEDBACK_ITEMS);
  assert.equal(result.grammar_mistakes.length, MAX_GRAMMAR_MISTAKES);
});

test("grammar mistakes must quote exact transcript text", () => {
  const result = normalizeContentAnalysis({
    ...full,
    grammar_mistakes: [
      { quote: "This is a useful answer", correction: "This was a useful answer", explanation: "Tense." },
      { quote: "not present", correction: "fabricated", explanation: "Must be rejected." },
    ],
  }, transcript);
  assert.equal(result.grammar_mistakes.length, 1);
  assert.equal(result.grammar_mistakes[0].quote, "This is a useful answer");
});

test("prompt restricts evaluation to text-only content dimensions and mode context", () => {
  const prompt = buildContentPrompt({ transcript, prompt_text: "Tell me about a challenge.", mode: "interview" });
  assert.match(prompt, /Score ONLY grammar, vocabulary, structure, and relevance/);
  assert.match(prompt, /cannot hear audio/);
  assert.match(prompt, /STAR/);
  assert.match(prompt, /genuinely rambling/i);
  assert.match(prompt, /under 20 words/);
});

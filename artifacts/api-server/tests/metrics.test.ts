import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePauses,
  computeSpeechMetrics,
  countFillers,
  countPhrase,
  lexicalDiversity,
  normalizeWords,
  sentenceStats,
  timingsMatchTranscript,
  type WordTiming,
} from "../src/lib/metrics.ts";

const words = (...entries: Array<[string, number, number]>): WordTiming[] =>
  entries.map(([word, start, end]) => ({ word, start, end }));

test("substring traps: number and umbrella are not fillers", () => {
  const text = "The number of umbrellas in the umbrella stand is a number I forgot.";

  assert.equal(countPhrase(text, "um"), 0);
  assert.equal(countFillers(text).scored, 0);
  assert.equal(countFillers(text).possible, 0);
});

test("whole words and phrases are counted once each", () => {
  const text = "Um, so I uh think, you know, it was kind of sort of, I mean, er, ah.";

  const report = countFillers(text);
  assert.equal(report.scored, 8);
  assert.deepEqual(report.scored_terms, {
    um: 1,
    uh: 1,
    er: 1,
    ah: 1,
    "you know": 1,
    "i mean": 1,
    "sort of": 1,
    "kind of": 1,
  });
});

test("elongated filler spellings collapse to the lexicon term", () => {
  const report = countFillers("Umm, uhh, ahh, err, umbrella, number.");

  assert.equal(report.scored, 4);
  assert.deepEqual(report.scored_terms, { um: 1, uh: 1, ah: 1, er: 1 });
});

test("possible fillers are reported but excluded from the score", () => {
  const report = countFillers("So I was like, right, actually basically literally fine.");

  assert.equal(report.scored, 0);
  assert.equal(report.possible, 6);
  assert.equal(report.possible_terms.like, 1);
});

test("a filler inside a larger word is ignored, but the standalone word counts", () => {
  assert.equal(countPhrase("Um, I mean, umbrella.", "um"), 1);
  assert.equal(countPhrase("I mean, umbrella.", "um"), 0);
  assert.equal(countPhrase("number", "um"), 0);
  assert.equal(countPhrase("Ummm", "um"), 0);
});

test("pauses come from gaps between consecutive words", () => {
  const timings = words(
    ["one", 0, 0.4],
    ["two", 0.5, 0.9],
    ["three", 1.0, 1.4],
    ["four", 2.6, 3.0],
    ["five", 3.1, 3.5],
  );

  const pauses = computePauses(timings, 0.8);
  assert.equal(pauses?.count, 1);
  assert.equal(pauses?.total_sec, 1.2);
  assert.equal(pauses?.average_sec, 1.2);
  assert.equal(pauses?.longest_sec, 1.2);
});

test("a gap exactly at the threshold is not a pause", () => {
  const timings = words(["a", 0, 1], ["b", 1.8, 2.2]);
  assert.equal(computePauses(timings, 0.8)?.count, 0);
});

test("pauses are null when there are fewer than two words", () => {
  assert.equal(computePauses([]), null);
  assert.equal(computePauses(words(["only", 0, 0.4])), null);
});

test("wpm covers the whole recording while articulation rate removes pauses", () => {
  const timings = words(
    ["one", 0, 0.4],
    ["two", 0.5, 0.9],
    ["three", 1.0, 1.4],
    ["four", 2.6, 3.0],
    ["five", 3.1, 3.5],
    ["six", 3.6, 4.0],
    ["seven", 4.1, 4.5],
    ["eight", 4.6, 5.0],
    ["nine", 5.1, 5.5],
    ["ten", 5.6, 6.0],
  );

  const metrics = computeSpeechMetrics({
    transcript: "one two three four five six seven eight nine ten",
    words: timings,
    durationSec: 12,
  });

  assert.equal(metrics.word_count, 10);
  assert.equal(metrics.wpm, 50);
  assert.equal(metrics.speaking_time_sec, 4.8);
  assert.equal(metrics.articulation_rate, 125);
  assert.equal(metrics.pauses?.count, 1);
  assert.equal(metrics.used_word_timings, true);
});

test("articulation rate is null without usable word timings", () => {
  const metrics = computeSpeechMetrics({
    transcript: "one two three four",
    durationSec: 10,
  });

  assert.equal(metrics.wpm, 24);
  assert.equal(metrics.articulation_rate, null);
  assert.equal(metrics.speaking_time_sec, null);
  assert.equal(metrics.pauses, null);
  assert.equal(metrics.used_word_timings, false);
});

test("edited transcripts stop trusting stale timings", () => {
  const timings = words(["one", 0, 0.3], ["two", 0.4, 0.7]);

  assert.equal(timingsMatchTranscript("one two", timings), true);
  assert.equal(timingsMatchTranscript("one two three", timings), false);
  assert.equal(timingsMatchTranscript("two one", timings), false);

  const metrics = computeSpeechMetrics({
    transcript: "one two three",
    words: timings,
    durationSec: 5,
  });

  assert.equal(metrics.used_word_timings, false);
  assert.equal(metrics.articulation_rate, null);
});

test("malformed timings are rejected instead of repaired", () => {
  assert.equal(normalizeWords(null), null);
  assert.equal(normalizeWords([]), null);
  assert.equal(normalizeWords([{ word: "a", start: 1, end: 0.5 }]), null);
  assert.equal(normalizeWords([{ word: "a", start: Number.NaN, end: 1 }]), null);
  assert.equal(
    normalizeWords([{ word: "a", start: 1, end: 2 }, { word: "b", start: 0.5, end: 0.9 }]),
    null,
  );
});

test("empty input measures nothing", () => {
  const metrics = computeSpeechMetrics({ transcript: "   ", durationSec: 0 });

  assert.equal(metrics.word_count, 0);
  assert.equal(metrics.duration_sec, null);
  assert.equal(metrics.wpm, null);
  assert.equal(metrics.articulation_rate, null);
  assert.equal(metrics.pauses, null);
  assert.equal(metrics.lexical_diversity, null);
  assert.equal(metrics.sentence_count, 0);
  assert.equal(metrics.average_sentence_words, null);
  assert.deepEqual(metrics.fillers, {
    scored: 0,
    possible: 0,
    scored_terms: {},
    possible_terms: {},
  });
});

test("a single word still has a wpm but no pauses or rhythm", () => {
  const metrics = computeSpeechMetrics({ transcript: "Hello", durationSec: 2 });

  assert.equal(metrics.word_count, 1);
  assert.equal(metrics.wpm, 30);
  assert.equal(metrics.pauses, null);
  assert.equal(metrics.articulation_rate, null);
  assert.equal(metrics.lexical_diversity, 1);
});

test("lexical diversity uses a fixed window and falls with repetition", () => {
  assert.equal(lexicalDiversity([]), null);
  assert.equal(lexicalDiversity(["a", "b", "c"]), 1);

  const unique = Array.from({ length: 60 }, (_, index) => `word${index}`);
  const repetitive = Array.from({ length: 60 }, () => "again");

  const diverse = lexicalDiversity(unique, 10);
  const dull = lexicalDiversity(repetitive, 10);

  assert.equal(diverse, 1);
  assert.equal(dull, 0.1);
  assert.ok(dull !== null && diverse !== null && dull < diverse);
});

test("sentence length averages over real sentences only", () => {
  const stats = sentenceStats("One two three. Four five! Six?");
  assert.equal(stats.sentence_count, 3);
  assert.equal(stats.average_sentence_words, 2);

  const none = sentenceStats("no terminal punctuation here");
  assert.equal(none.sentence_count, 1);
  assert.equal(none.average_sentence_words, 4);

  const empty = sentenceStats("   ");
  assert.equal(empty.sentence_count, 0);
  assert.equal(empty.average_sentence_words, null);
});

test("very short audio with a real word does not divide by zero", () => {
  const metrics = computeSpeechMetrics({
    transcript: "Yes",
    words: words(["Yes", 0, 0.2]),
    durationSec: 0.4,
  });

  assert.equal(metrics.wpm, 150);
  // One word has no rhythm to measure: no pause, no speaking span to divide by.
  assert.equal(metrics.articulation_rate, null);
  assert.equal(metrics.speaking_time_sec, null);
  assert.equal(metrics.pauses, null);
});

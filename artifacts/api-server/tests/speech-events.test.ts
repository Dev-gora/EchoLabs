import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSpeechEvents, detectSilenceEvents, detectFillerBursts, detectRepairRestart } from "../src/lib/speech-events.ts";

test("no events on clean speech", () => {
  const events = detectSpeechEvents({
    transcript: "This is a clean sentence with no fillers.",
    words: [
      { word: "This", start: 0, end: 0.3 },
      { word: "is", start: 0.3, end: 0.5 },
      { word: "a", start: 0.5, end: 0.6 },
      { word: "clean", start: 0.6, end: 0.9 },
      { word: "sentence", start: 0.9, end: 1.2 },
      { word: "with", start: 1.2, end: 1.4 },
      { word: "no", start: 1.4, end: 1.5 },
      { word: "fillers.", start: 1.5, end: 1.8 },
    ],
    durationSec: 2,
    silenceIntervals: [],
  });
  assert.equal(events.length, 0);
});

test("silence events at thresholds", () => {
  const events = detectSilenceEvents({
    transcript: "hi",
    words: [],
    silenceIntervals: [
      { start: 1.0, end: 2.0 }, // 1.0s - medium
      { start: 3.0, end: 4.6 }, // 1.6s - high
    ],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "silence_event");
  assert.equal(events[1].severity, "high");
});

test("filler burst with overlapping windows merged", () => {
  const words = [];
  let t = 0;
  // create 4 "um" fillers close together
  for (let i = 0; i < 4; i++) {
    words.push({ word: "um", start: t, end: t + 0.2 });
    t += 0.3;
  }
  const events = detectFillerBursts({ transcript: "um um um um", words, durationSec: 10 });
  assert.ok(events.length >= 1);
  assert.equal(events[0].type, "filler_burst");
});

test("repair restart on repetition", () => {
  const events = detectRepairRestart({
    transcript: "I I went there",
    words: [
      { word: "I", start: 0, end: 0.2 },
      { word: "I", start: 0.25, end: 0.45 }, // repeated within 0.7s
      { word: "went", start: 0.5, end: 0.7 },
      { word: "there", start: 0.7, end: 0.9 },
    ],
  });
  assert.ok(events.length >= 1);
  assert.equal(events[0].type, "repair_restart");
});

test("events at start and end", () => {
  const events = detectSpeechEvents({
    transcript: "um hello um world um",
    words: [
      { word: "um", start: 0.0, end: 0.2 },
      { word: "hello", start: 0.3, end: 0.5 },
      { word: "um", start: 0.6, end: 0.8 },
      { word: "world", start: 0.9, end: 1.1 },
      { word: "um", start: 9.0, end: 9.2 },
    ],
    durationSec: 10,
    silenceIntervals: [],
  });
  // should detect filler occurrences
  assert.ok(events.some((e) => e.type === "filler_burst" || e.type === "repair_restart"));
});

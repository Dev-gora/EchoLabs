/**
 * Timestamped speech events driven by real word timestamps from ASR.
 * No even-split timestamp estimation.
 */

import type { WordTiming } from "./metrics.ts";
import { SCORED_FILLERS, normalizeWords } from "./metrics.ts";

export type SpeechEventType = "silence_event" | "filler_burst" | "repair_restart";

export type SpeechEvent = {
  type: SpeechEventType;
  start: number;
  end: number;
  severity: "low" | "medium" | "high";
  score: number; // 0-1 numeric score for the event
  evidence: Record<string, unknown>;
  message: string;
};

export type SpeechEventsInput = {
  transcript: string;
  words?: readonly WordTiming[] | null;
  durationSec?: number | null;
  silenceIntervals?: Array<{ start: number; end: number }> | null;
};

const SILENCE_SHORT_THRESHOLD_SEC = 0.8;
const SILENCE_LONG_THRESHOLD_SEC = 1.5;

const FILLER_BURST_WINDOW_SEC = 10.0;
const FILLER_BURST_MIN_COUNT = 3;
const FILLER_BURST_MERGE_GAP_SEC = 1.0;

const REPAIR_REPEAT_MAX_GAP_SEC = 0.7;
const REPAIR_MARKERS = ["i mean", "sorry", "let me rephrase", "what i meant was"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function severityFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 0.75) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function getScoredFillerOccurrences(words: WordTiming[]): Array<{ token: string; start: number; end: number }> {
  const occurrences: Array<{ token: string; start: number; end: number }> = [];
  // Build text window around words to catch multi-word fillers? Easier to check adjacent pairs for multi-word
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const token = w.word.toLowerCase().replace(/[^a-z']/g, "");
    // check single word scored fillers
    for (const filler of SCORED_FILLERS) {
      if (filler.includes(" ")) continue; // multi-word handled separately
      if (token === filler.replace(/[^a-z']/g, "")) {
        occurrences.push({ token: filler, start: w.start, end: w.end });
        break;
      }
    }
  }
  // check multi-word fillers by joining
  for (const filler of SCORED_FILLERS) {
    if (!filler.includes(" ")) continue;
    const parts = filler.split(/\s+/);
    if (parts.length === 2 && words.length >= 2) {
      for (let i = 0; i < words.length - 1; i++) {
        const t1 = words[i].word.toLowerCase().replace(/[^a-z']/g, "");
        const t2 = words[i + 1].word.toLowerCase().replace(/[^a-z']/g, "");
        if (t1 === parts[0] && t2 === parts[1]) {
          occurrences.push({ token: filler, start: words[i].start, end: words[i + 1].end });
        }
      }
    } else if (parts.length === 3 && words.length >= 3) {
      for (let i = 0; i < words.length - 2; i++) {
        const t1 = words[i].word.toLowerCase().replace(/[^a-z']/g, "");
        const t2 = words[i + 1].word.toLowerCase().replace(/[^a-z']/g, "");
        const t3 = words[i + 2].word.toLowerCase().replace(/[^a-z']/g, "");
        if (t1 === parts[0] && t2 === parts[1] && t3 === parts[2]) {
          occurrences.push({ token: filler, start: words[i].start, end: words[i + 2].end });
        }
      }
    }
  }
  return occurrences.sort((a, b) => a.start - b.start);
}

export function detectSilenceEvents(input: SpeechEventsInput): SpeechEvent[] {
  const events: SpeechEvent[] = [];
  const intervals = input.silenceIntervals;
  if (!intervals || intervals.length === 0) return events;

  for (const interval of intervals) {
    const start = Number(interval.start);
    const end = Number(interval.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const dur = end - start;
    if (dur < SILENCE_SHORT_THRESHOLD_SEC) continue;

    let score: number;
    let message: string;
    if (dur >= SILENCE_LONG_THRESHOLD_SEC) {
      score = clamp01(0.75 + 0.25 * (dur - SILENCE_LONG_THRESHOLD_SEC) / 1.5);
      message = `Long silence (${dur.toFixed(1)}s) broke the flow of delivery.`;
    } else {
      score = clamp01(0.4 + 0.35 * (dur - SILENCE_SHORT_THRESHOLD_SEC) / Math.max(SILENCE_LONG_THRESHOLD_SEC - SILENCE_SHORT_THRESHOLD_SEC, 1e-6));
      message = `Noticeable pause (${dur.toFixed(1)}s) created a brief break in sentence connection.`;
    }

    events.push({
      type: "silence_event",
      start: round2(start),
      end: round2(end),
      severity: severityFromScore(score),
      score: round3(score),
      evidence: {
        duration_sec: round3(dur),
        short_threshold_sec: SILENCE_SHORT_THRESHOLD_SEC,
        long_threshold_sec: SILENCE_LONG_THRESHOLD_SEC,
      },
      message,
    });
  }
  return events;
}

export function detectFillerBursts(input: SpeechEventsInput): SpeechEvent[] {
  const words = normalizeWords(input.words);
  if (!words || words.length === 0) return [];

  const occurrences = getScoredFillerOccurrences(words);
  if (occurrences.length === 0) return [];

  const rawWindows: Array<{ start: number; end: number; count: number; tokens: string[] }> = [];
  let j = 0;
  const n = occurrences.length;
  for (let i = 0; i < n; i++) {
    const startT = occurrences[i].start;
    while (j < n && occurrences[j].start <= startT + FILLER_BURST_WINDOW_SEC) {
      j++;
    }
    const count = j - i;
    if (count >= FILLER_BURST_MIN_COUNT) {
      rawWindows.push({
        start: startT,
        end: Math.min(startT + FILLER_BURST_WINDOW_SEC, input.durationSec ?? startT + FILLER_BURST_WINDOW_SEC),
        count,
        tokens: occurrences.slice(i, j).map((x) => x.token),
      });
    }
  }

  if (rawWindows.length === 0) return [];

  const merged: Array<{ start: number; end: number; count: number; tokens: string[] }> = [];
  let cur = { ...rawWindows[0] };
  for (let k = 1; k < rawWindows.length; k++) {
    const nxt = rawWindows[k];
    if (nxt.start <= cur.end + FILLER_BURST_MERGE_GAP_SEC) {
      cur.end = Math.max(cur.end, nxt.end);
      cur.count = Math.max(cur.count, nxt.count);
      cur.tokens.push(...nxt.tokens);
    } else {
      merged.push(cur);
      cur = { ...nxt };
    }
  }
  merged.push(cur);

  const events: SpeechEvent[] = [];
  for (const w of merged) {
    const count = w.count;
    const uniqTokens = Array.from(new Set(w.tokens));
    const score = clamp01(0.35 + 0.15 * (count - FILLER_BURST_MIN_COUNT));
    events.push({
      type: "filler_burst",
      start: round2(w.start),
      end: round2(w.end),
      severity: severityFromScore(score),
      score: round3(score),
      evidence: {
        window_sec: FILLER_BURST_WINDOW_SEC,
        filler_count: count,
        tokens: uniqTokens.slice(0, 10),
      },
      message: `Cluster of ${count} scored fillers in ~10s window (${uniqTokens.slice(0, 3).join(", ")}).`,
    });
  }
  return events;
}

export function detectRepairRestart(input: SpeechEventsInput): SpeechEvent[] {
  const words = normalizeWords(input.words);
  if (!words || words.length === 0) return [];

  const candidates: Array<{ start: number; end: number; evidence: Record<string, unknown> }> = [];

  // repeated word within 0.7s
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].word.toLowerCase().replace(/[^a-z']/g, "");
    const w2 = words[i + 1].word.toLowerCase().replace(/[^a-z']/g, "");
    if (!w1 || !w2) continue;
    if (w1 === w2) {
      const gap = words[i + 1].start - words[i].end;
      if (gap <= REPAIR_REPEAT_MAX_GAP_SEC) {
        candidates.push({
          start: words[i].start,
          end: words[i + 1].end,
          evidence: { pattern: "repetition", token: w1, gap_sec: round3(gap) },
        });
      }
    }
  }

  // repair markers
  const lowerTranscript = input.transcript.toLowerCase();
  for (const marker of REPAIR_MARKERS) {
    // find occurrences
    const regex = new RegExp(`\\b${marker.replace(/\s+/g, "\\s+")}\\b`, "g");
    let match;
    while ((match = regex.exec(lowerTranscript)) !== null) {
      // try to map to approximate word timings - find nearest word
      // rough approximation: find first word whose start >= match index roughly
      candidates.push({
        start: words[0]?.start ?? 0,
        end: words[Math.min(words.length - 1, 2)]?.end ?? 0,
        evidence: { pattern: "repair_marker", token: marker },
      });
      break; // just mark presence
    }
  }
  // better: check phrases in word sequence
  for (let i = 0; i < words.length - 1; i++) {
    const phrase2 = (words[i].word + " " + words[i + 1].word).toLowerCase().replace(/[^a-z'\s]/g, "");
    if (phrase2.includes("i mean")) {
      candidates.push({ start: words[i].start, end: words[i + 1].end, evidence: { pattern: "repair_marker_phrase", token: "i mean" } });
    }
  }

  if (candidates.length === 0) return [];

  // merge
  candidates.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number; evidenceList: Record<string, unknown>[] }> = [];
  let cur = { start: candidates[0].start, end: candidates[0].end, evidenceList: [candidates[0].evidence] };
  for (let k = 1; k < candidates.length; k++) {
    const c = candidates[k];
    if (c.start <= cur.end + 0.8) {
      cur.end = Math.max(cur.end, c.end);
      cur.evidenceList.push(c.evidence);
    } else {
      merged.push(cur);
      cur = { start: c.start, end: c.end, evidenceList: [c.evidence] };
    }
  }
  merged.push(cur);

  const events: SpeechEvent[] = [];
  for (const m of merged) {
    const patterns = m.evidenceList.map((e) => e.pattern as string);
    const tokens = m.evidenceList.map((e) => e.token).filter(Boolean) as string[];
    const count = m.evidenceList.length;
    const score = clamp01(0.35 + 0.2 * (count - 1));
    let message: string;
    if (patterns.includes("repetition") && patterns.some((p) => p.includes("repair_marker"))) {
      message = "Self-correction after repetition disrupted the flow.";
    } else if (patterns.includes("repetition")) {
      message = "Word repetition indicated a restart/hiccup in delivery.";
    } else {
      message = "Repair/rephrase marker detected mid-thought.";
    }
    events.push({
      type: "repair_restart",
      start: round2(m.start),
      end: round2(m.end),
      severity: severityFromScore(score),
      score: round3(score),
      evidence: { count, patterns, tokens },
      message,
    });
  }
  return events;
}

export function detectSpeechEvents(input: SpeechEventsInput): SpeechEvent[] {
  const silence = detectSilenceEvents(input);
  const fillerBursts = detectFillerBursts(input);
  const repairs = detectRepairRestart(input);
  const all = [...silence, ...fillerBursts, ...repairs];
  all.sort((a, b) => (a.start - b.start) || (b.score - a.score));
  return all;
}

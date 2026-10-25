/**
 * Deterministic speech metrics.
 *
 * Pure functions over a transcript, its word timings and the true audio
 * duration. No model, no randomness, no defaults: anything that cannot be
 * measured comes back as `null` so the UI can show "not measured" instead of a
 * number that looks measured. See `.agents/memory/evaluation-integrity.md`.
 *
 * Reference idea from Eloq `services/metrics_service.py` (WPM / fillers /
 * pauses), reimplemented. Its implementation counted fillers with
 * `transcript.lower().count(filler)`, so "number" scored as an "um" and
 * "umbrella" too; that is fixed here with word-boundary matching.
 */

/** A pause shorter than this is breathing, not dead air. */
export const PAUSE_THRESHOLD_SEC = 0.8;

/**
 * Window for moving-average type-token ratio. 50 words is the usual choice in
 * lexical-diversity work: long enough to be stable, short enough to track a
 * speaker who starts repeating themselves halfway through.
 */
export const LEXICAL_DIVERSITY_WINDOW = 50;

/**
 * Fillers that count against the score. Multi-word entries are matched as
 * whole phrases so "kind of" is one filler, not two words.
 */
export const SCORED_FILLERS = [
  "um",
  "uh",
  "er",
  "ah",
  "you know",
  "i mean",
  "sort of",
  "kind of",
] as const;

/**
 * Words that are frequently fillers but often carry meaning ("like" as a verb,
 * "so" as a conjunction, "right" as a direction). Reported separately and kept
 * out of the score because the transcript alone cannot tell them apart.
 */
export const POSSIBLE_FILLERS = [
  "like",
  "so",
  "right",
  "actually",
  "basically",
  "literally",
] as const;

/**
 * Whisper spells held fillers with repeated letters ("Umm", "Uhh", "Ahh").
 * Collapsing those to the lexicon term keeps them countable without returning to
 * substring matching: "um" inside "umbrella" still never matches because every
 * pattern is anchored by word boundaries.
 */
const ELONGATED_FILLERS: ReadonlyArray<{ pattern: RegExp; term: string }> = [
  { pattern: /\bum{2,}\b/gi, term: "um" },
  { pattern: /\buh{2,}\b/gi, term: "uh" },
  { pattern: /\bah{2,}\b/gi, term: "ah" },
  { pattern: /\ber{2,}\b/gi, term: "er" },
];

export type WordTiming = {
  word: string;
  start: number;
  end: number;
};

export type FillerReport = {
  /** Count that feeds the score. */
  scored: number;
  /** Count reported but excluded from the score. */
  possible: number;
  scored_terms: Record<string, number>;
  possible_terms: Record<string, number>;
};

export type PauseReport = {
  threshold_sec: number;
  count: number;
  total_sec: number;
  average_sec: number;
  longest_sec: number;
};

export type SpeechMetrics = {
  word_count: number;
  /** True audio duration in seconds, or null when unknown. */
  duration_sec: number | null;
  /** Words per minute over the whole recording, silence included. */
  wpm: number | null;
  /** Words per minute while actually speaking, pauses removed. */
  articulation_rate: number | null;
  /** Seconds spent speaking (word span minus pauses). */
  speaking_time_sec: number | null;
  pauses: PauseReport | null;
  fillers: FillerReport;
  /** Moving-average type-token ratio in 0..1. */
  lexical_diversity: number | null;
  sentence_count: number;
  average_sentence_words: number | null;
  /** False when word timings were missing or did not match the transcript. */
  used_word_timings: boolean;
};

export type SpeechMetricsInput = {
  transcript: string;
  words?: readonly WordTiming[] | null;
  durationSec?: number | null;
};

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Lowercase, punctuation-free tokens. Apostrophes stay so "don't" is one word. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Counts occurrences of one phrase as whole words. `\b` on both sides is what
 * keeps "um" out of "number" and "umbrella".
 */
export function countPhrase(text: string, phrase: string): number {
  if (phrase.trim().length === 0) return 0;
  const pattern = new RegExp(`\\b${escapeRegExp(phrase.trim())}\\b`, "gi");
  return (text.match(pattern) ?? []).length;
}

function countTerms(
  text: string,
  phrases: readonly string[],
): { total: number; terms: Record<string, number> } {
  const terms: Record<string, number> = {};
  let total = 0;

  for (const phrase of phrases) {
    const count = countPhrase(text, phrase);
    if (count > 0) {
      terms[phrase] = count;
      total += count;
    }
  }

  return { total, terms };
}

export function countFillers(transcript: string): FillerReport {
  const scored = countTerms(transcript, SCORED_FILLERS);
  const possible = countTerms(transcript, POSSIBLE_FILLERS);

  for (const { pattern, term } of ELONGATED_FILLERS) {
    const count = (transcript.match(pattern) ?? []).length;
    if (count === 0) continue;
    scored.terms[term] = (scored.terms[term] ?? 0) + count;
    scored.total += count;
  }

  return {
    scored: scored.total,
    possible: possible.total,
    scored_terms: scored.terms,
    possible_terms: possible.terms,
  };
}

/**
 * Keeps timings that are usable: finite, ordered, and not ending before they
 * start. Anything else is dropped rather than repaired into a plausible number.
 */
export function normalizeWords(
  words: readonly WordTiming[] | null | undefined,
): WordTiming[] | null {
  if (!words || words.length === 0) return null;

  const cleaned: WordTiming[] = [];

  for (const word of words) {
    if (typeof word?.word !== "string") return null;
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) return null;
    if (word.start < 0 || word.end < word.start) return null;
    cleaned.push({ word: word.word, start: word.start, end: word.end });
  }

  for (let index = 1; index < cleaned.length; index += 1) {
    if (cleaned[index].start < cleaned[index - 1].start) return null;
  }

  return cleaned;
}

/** Word timings only count when they describe the transcript we are scoring. */
export function timingsMatchTranscript(
  transcript: string,
  words: readonly WordTiming[] | null | undefined,
): boolean {
  const normalized = normalizeWords(words);
  if (!normalized) return false;

  const transcriptTokens = tokenize(transcript);
  const wordTokens = tokenize(normalized.map((word) => word.word).join(" "));

  if (transcriptTokens.length !== wordTokens.length) return false;

  return transcriptTokens.every((token, index) => token === wordTokens[index]);
}

/**
 * Pauses are the gaps between consecutive words, so this needs word timings.
 * Returns null when there are fewer than two words to sit between.
 */
export function computePauses(
  words: readonly WordTiming[] | null | undefined,
  thresholdSec: number = PAUSE_THRESHOLD_SEC,
): PauseReport | null {
  const normalized = normalizeWords(words);
  if (!normalized || normalized.length < 2) return null;

  const gaps: number[] = [];
  for (let index = 1; index < normalized.length; index += 1) {
    const gap = normalized[index].start - normalized[index - 1].end;
    if (gap > thresholdSec) gaps.push(gap);
  }

  const total = gaps.reduce((sum, gap) => sum + gap, 0);

  return {
    threshold_sec: thresholdSec,
    count: gaps.length,
    total_sec: round(total),
    average_sec: gaps.length === 0 ? 0 : round(total / gaps.length),
    longest_sec: gaps.length === 0 ? 0 : round(Math.max(...gaps)),
  };
}

/**
 * Moving-average type-token ratio: slide a fixed window, average the ratio from
 * each window. A plain type-token ratio falls with text length, so it cannot be
 * compared between a 40-word answer and a 200-word one.
 */
export function lexicalDiversity(
  tokens: readonly string[],
  window: number = LEXICAL_DIVERSITY_WINDOW,
): number | null {
  if (tokens.length === 0) return null;

  const size = Math.max(2, Math.min(window, tokens.length));
  if (tokens.length <= size) {
    return round(new Set(tokens).size / tokens.length, 3);
  }

  let total = 0;
  let windows = 0;

  for (let start = 0; start + size <= tokens.length; start += 1) {
    total += new Set(tokens.slice(start, start + size)).size / size;
    windows += 1;
  }

  return windows === 0 ? null : round(total / windows, 3);
}

export function sentenceStats(text: string): {
  sentence_count: number;
  average_sentence_words: number | null;
} {
  const sentences = text
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return { sentence_count: 0, average_sentence_words: null };
  }

  const words = sentences.reduce(
    (sum, sentence) => sum + tokenize(sentence).length,
    0,
  );

  return {
    sentence_count: sentences.length,
    average_sentence_words: round(words / sentences.length, 1),
  };
}

export function computeSpeechMetrics(input: SpeechMetricsInput): SpeechMetrics {
  const transcript = input.transcript ?? "";
  const tokens = tokenize(transcript);
  const wordCount = tokens.length;

  const duration =
    typeof input.durationSec === "number" && Number.isFinite(input.durationSec) && input.durationSec > 0
      ? input.durationSec
      : null;

  const timingsUsable = wordCount > 0 && timingsMatchTranscript(transcript, input.words);
  const words = timingsUsable ? normalizeWords(input.words) : null;

  const pauses = computePauses(words);
  const sentences = sentenceStats(transcript);

  // WPM covers the whole recording, so silence lowers it — that is what a
  // listener experiences. Articulation rate removes pauses to show how fast the
  // speaker moves when they are actually talking.
  const wpm =
    wordCount > 0 && duration !== null
      ? round((wordCount / duration) * 60, 1)
      : null;

  let speakingTime: number | null = null;
  let articulationRate: number | null = null;

  if (words && words.length >= 2) {
    const span = words[words.length - 1].end - words[0].start;
    const pauseTime = pauses?.total_sec ?? 0;
    const speaking = span - pauseTime;

    if (span > 0) {
      speakingTime = round(Math.max(0, speaking));
      articulationRate =
        speaking > 0 ? round((wordCount / speaking) * 60, 1) : null;
    }
  }

  return {
    word_count: wordCount,
    duration_sec: duration === null ? null : round(duration, 2),
    wpm,
    articulation_rate: articulationRate,
    speaking_time_sec: speakingTime,
    pauses,
    fillers: countFillers(transcript),
    lexical_diversity: lexicalDiversity(tokens),
    sentence_count: sentences.sentence_count,
    average_sentence_words: sentences.average_sentence_words,
    used_word_timings: words !== null,
  };
}

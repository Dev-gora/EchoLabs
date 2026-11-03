import type {
  AnalyzeRequest,
  AnalyzeResponse,
  MetricsResponse,
  ScoresResponse,
  SpeechSegment,
} from "@workspace/api-zod";

/**
 * Delivery analysis.
 *
 * Everything here is derived from what the client actually captured: the words
 * the speaker said and how long they spoke for. Scores are deliberately framed
 * as delivery indicators, not as a judgement of communication quality — see
 * `.agents/memory/evaluation-integrity.md`.
 */

/** Pauses shorter than this are normal breathing, not dead air. */
export const PAUSE_THRESHOLD_SEC = 0.8;

/** Comfortable delivery band for interview / debate answers. */
export const WPM_BAND = { min: 110, max: 160 } as const;

/**
 * Kept short and unambiguous on purpose. "actually" is excluded because it is
 * frequently a legitimate adverb in a spoken answer.
 */
const FILLER_PHRASES = [
  "you know",
  "i mean",
  "sort of",
  "kind of",
  "um",
  "uh",
  "er",
  "ah",
  "like",
  "basically",
  "literally",
] as const;

/**
 * "like" is only a filler when it is not a verb or a comparison auxiliary.
 * Without word-level timing we cannot do better than this narrow guard.
 */
const LIKE_VERB_CONTEXT = new Set([
  "would",
  "will",
  "do",
  "does",
  "did",
  "don't",
  "doesn't",
  "didn't",
  "really",
  "much",
  "feel",
  "feels",
  "felt",
  "look",
  "looks",
  "looked",
  "seem",
  "seems",
  "something",
  "anything",
  "nothing",
]);

const DISCOURSE_MARKERS = [
  "because",
  "however",
  "therefore",
  "for example",
  "for instance",
  "first",
  "second",
  "finally",
  "although",
  "in contrast",
  "as a result",
] as const;

export type AnalysisResult = Omit<AnalyzeResponse, "session_id">;

/** Lowercase, punctuation-free tokens. Apostrophes stay so "don't" is one word. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function countFillers(tokens: string[]): number {
  let index = 0;
  let fillers = 0;

  while (index < tokens.length) {
    let consumed = 0;

    for (const phrase of FILLER_PHRASES) {
      const words = phrase.split(" ");
      const matches = words.every(
        (word, offset) => tokens[index + offset] === word,
      );

      if (!matches) continue;

      if (phrase === "like" && LIKE_VERB_CONTEXT.has(tokens[index - 1] ?? "")) {
        continue;
      }

      consumed = words.length;
      break;
    }

    if (consumed > 0) {
      fillers += 1;
      index += consumed;
    } else {
      index += 1;
    }
  }

  return fillers;
}

export function countPauses(segments: SpeechSegment[] | undefined): number {
  if (!segments || segments.length < 2) {
    return 0;
  }

  let pauses = 0;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const gap = segments[i + 1].start - segments[i].end;

    if (gap > PAUSE_THRESHOLD_SEC) {
      pauses += 1;
    }
  }

  return pauses;
}

const clampScore = (value: number): number =>
  Math.max(1, Math.min(10, Math.round(value)));

function repeatedWords(tokens: string[]): Map<string, number> {
  const repeats = new Map<string, number>();

  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] === tokens[i - 1] && /^[a-z']+$/.test(tokens[i])) {
      repeats.set(tokens[i], (repeats.get(tokens[i]) ?? 0) + 1);
    }
  }

  return repeats;
}

function computeMetrics(
  input: AnalyzeRequest,
  tokens: string[],
): MetricsResponse {
  const wordCount = tokens.length;
  const duration = Math.max(0, input.duration);
  const wpm = duration > 0 ? (wordCount / duration) * 60 : 0;

  return {
    wpm: Math.round(wpm * 10) / 10,
    fillers: countFillers(tokens),
    pauses: countPauses(input.segments),
    word_count: wordCount,
    duration: Math.round(duration * 10) / 10,
  };
}

function computeScores(
  tokens: string[],
  sentences: string[],
  metrics: MetricsResponse,
): ScoresResponse {
  // Fluency: pace inside the comfort band, minus a penalty per filler density.
  const paceGap =
    metrics.wpm < WPM_BAND.min
      ? WPM_BAND.min - metrics.wpm
      : metrics.wpm > WPM_BAND.max
        ? metrics.wpm - WPM_BAND.max
        : 0;
  const pacePenalty = Math.min(4, Math.ceil(paceGap / 25));

  const fillerRate =
    metrics.word_count > 0 ? (metrics.fillers / metrics.word_count) * 100 : 0;
  const fillerPenalty = fillerRate <= 2 ? 0 : fillerRate <= 5 ? 1 : fillerRate <= 8 ? 2 : 3;

  const fluency = clampScore(10 - pacePenalty - fillerPenalty);

  // Vocabulary: how much of the answer is new words rather than repetition.
  const unique = new Set(tokens).size;
  const typeTokenRatio = metrics.word_count > 0 ? unique / metrics.word_count : 0;
  const vocabulary = clampScore(
    2 + typeTokenRatio * 8 + (unique >= 50 ? 1 : 0),
  );

  // Grammar: only the repeated-word and over-long-sentence signals we can see.
  const repeats = [...repeatedWords(tokens).values()].reduce(
    (total, count) => total + count,
    0,
  );
  const longSentences = sentences.filter(
    (sentence) => tokenize(sentence).length > 40,
  ).length;

  const grammar = clampScore(10 - Math.min(4, repeats) - Math.min(2, longSentences));

  // Structure: sentence count and shape, plus signposting words.
  const sentenceCount = sentences.length;
  const averageSentenceWords =
    sentenceCount > 0 ? metrics.word_count / sentenceCount : 0;

  let structure = 10;

  if (averageSentenceWords > 30) structure -= 3;
  else if (averageSentenceWords > 24) structure -= 2;

  if (averageSentenceWords < 6) structure -= 2;
  if (sentenceCount < 3) structure -= 2;

  const markers = DISCOURSE_MARKERS.filter((marker) =>
    new RegExp(`\\b${marker}\\b`).test(tokens.join(" ")),
  ).length;

  if (markers >= 2) structure += 1;
  if (markers >= 4) structure += 1;

  return {
    fluency,
    vocabulary,
    grammar,
    structure: clampScore(structure),
  };
}

function buildFeedback(
  input: AnalyzeRequest,
  metrics: MetricsResponse,
  scores: ScoresResponse,
  uniqueWords: number,
  sentenceCount: number,
): string[] {
  const feedback: string[] = [];

  if (metrics.wpm < WPM_BAND.min) {
    feedback.push(
      `Pace: ${metrics.wpm} wpm is below the ${WPM_BAND.min}–${WPM_BAND.max} wpm comfort band — the answer may sound hesitant.`,
    );
  } else if (metrics.wpm > WPM_BAND.max) {
    feedback.push(
      `Pace: ${metrics.wpm} wpm is above the ${WPM_BAND.min}–${WPM_BAND.max} wpm comfort band — slow down to let points land.`,
    );
  } else {
    feedback.push(
      `Pace: ${metrics.wpm} wpm sits inside the ${WPM_BAND.min}–${WPM_BAND.max} wpm comfort band.`,
    );
  }

  if (metrics.fillers === 0) {
    feedback.push("Fillers: no filler words detected in the transcript.");
  } else {
    const perHundred =
      metrics.word_count > 0
        ? Math.round((metrics.fillers / metrics.word_count) * 1000) / 10
        : 0;
    feedback.push(
      `Fillers: ${metrics.fillers} across ${metrics.word_count} words (${perHundred} per 100 words).`,
    );
  }

  if (input.segments && input.segments.length >= 2) {
    feedback.push(
      `Pauses: ${metrics.pauses} gap${metrics.pauses === 1 ? "" : "s"} longer than ${PAUSE_THRESHOLD_SEC}s.`,
    );
  } else {
    feedback.push(
      "Pauses: no speech segments were provided, so pause length was not measured.",
    );
  }

  feedback.push(
    `Vocabulary: ${uniqueWords} unique words across ${sentenceCount} sentence${sentenceCount === 1 ? "" : "s"} (structure score ${scores.structure}/10).`,
  );

  feedback.push(
    "Scores are delivery indicators computed from the transcript and duration, not a judgement of communication quality.",
  );

  return feedback;
}

export function analyzeRecording(input: AnalyzeRequest): AnalysisResult {
  const text = input.transcript.trim();
  const tokens = tokenize(text);
  const sentences = text
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const metrics = computeMetrics(input, tokens);
  const scores = computeScores(tokens, sentences, metrics);

  const repeats = repeatedWords(tokens);
  const grammarMistakes = [...repeats.entries()]
    .map(([word, count]) => `Repeated word "${word} ${word}" (${count + 1}×)`)
    .sort();

  return {
    audio_url: input.audio_url ?? "",
    transcript: text,
    duration: metrics.duration,
    metrics,
    scores,
    feedback: buildFeedback(
      input,
      metrics,
      scores,
      new Set(tokens).size,
      sentences.length,
    ),
    grammar_mistakes: grammarMistakes,
  };
}

/** Below this the sample is too small for any of the indicators to mean much. */
export const MIN_WORDS_FOR_ANALYSIS = 10;

export function hasEnoughSpeech(result: AnalysisResult): boolean {
  return result.metrics.word_count >= MIN_WORDS_FOR_ANALYSIS;
}

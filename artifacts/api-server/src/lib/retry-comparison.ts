export type AttemptSnapshot = {
  wpm: number | null;
  fillers: number | null;
  pauses: number | null;
  fluency_score: number | null;
  tempo_stability?: number | null;
  scores?: Record<string, number | null>;
};

export type RetryComparison = {
  original_attempt: AttemptSnapshot;
  current_attempt: AttemptSnapshot;
  improvements: Record<string, string | number>;
};

function signedDelta(current: number | null, original: number | null, unit: string = ""): string | number {
  if (current === null || original === null) return 0;
  const diff = current - original;
  if (unit) {
    if (diff === 0) return `unchanged (${unit})`;
    return diff > 0 ? `+${diff}${unit ? " " + unit : ""}` : `${diff}${unit ? " " + unit : ""}`;
  }
  return diff;
}

export function computeRetryComparison(original: AttemptSnapshot, current: AttemptSnapshot): RetryComparison {
  const improvements: Record<string, string | number> = {
    wpm: signedDelta(current.wpm, original.wpm, "wpm"),
    fillers: signedDelta(current.fillers, original.fillers, "fillers"),
    pauses: signedDelta(current.pauses, original.pauses, "pauses"),
    fluency_score: signedDelta(current.fluency_score, original.fluency_score, "points"),
  };
  if (original.tempo_stability !== undefined || current.tempo_stability !== undefined) {
    improvements.tempo_stability = signedDelta(current.tempo_stability ?? null, original.tempo_stability ?? null);
  }
  if (original.scores || current.scores) {
    const allKeys = new Set([...(original.scores ? Object.keys(original.scores) : []), ...(current.scores ? Object.keys(current.scores) : [])]);
    for (const k of allKeys) {
      improvements[`score_${k}`] = signedDelta(current.scores?.[k] ?? null, original.scores?.[k] ?? null);
    }
  }
  return {
    original_attempt: original,
    current_attempt: current,
    improvements,
  };
}

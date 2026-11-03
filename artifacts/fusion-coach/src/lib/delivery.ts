import { analyzeRecording, type AnalyzeResponse } from "@workspace/api-client-react";

/**
 * A transcript-based delivery read from the API server.
 *
 * The server has no ASR provider, so this only ever sees the words the browser
 * already recognised plus the measured duration of voice activity. Absence of a
 * read is surfaced as a state, never invented.
 */
export type DeliveryRead =
  | { status: "loading" }
  | { status: "ready"; analysis: AnalyzeResponse }
  | { status: "unavailable"; message: string };

const TIMEOUT_MS = 45_000;
const UNREACHABLE =
  "The analysis service is not reachable. Start the API server and try again.";

/** The generated client rejects with an ApiError, but only this shape is public. */
type HttpFailure = { status: number; data: unknown };

function isHttpFailure(error: unknown): error is HttpFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function messageFrom(error: unknown): string {
  if (isHttpFailure(error)) {
    const body = error.data as { message?: string } | null;

    if (body?.message) return body.message;
    if (error.status === 422) return "Not enough speech in this take to analyze.";
    if (error.status === 404) return "The server has no record of that session.";

    // A dev proxy answers 5xx with HTML when nothing is listening upstream, and
    // there is no JSON body to read in that case.
    if (error.status >= 500) return UNREACHABLE;

    return `The analysis service answered ${error.status}.`;
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The analysis service took too long to answer.";
  }

  return UNREACHABLE;
}

export async function requestDeliveryRead(
  transcript: string,
  durationSeconds: number,
): Promise<DeliveryRead> {
  const trimmed = transcript.trim();

  if (trimmed.length === 0) {
    return {
      status: "unavailable",
      message: "No final transcript was captured, so there was nothing to analyze.",
    };
  }

  try {
    const analysis = await analyzeRecording(
      {
        transcript: trimmed,
        duration: Math.max(1, Math.round(durationSeconds)),
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    return { status: "ready", analysis };
  } catch (error) {
    return { status: "unavailable", message: messageFrom(error) };
  }
}

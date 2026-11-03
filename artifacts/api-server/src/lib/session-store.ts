import { randomUUID } from "node:crypto";
import type { AnalyzeResponse } from "@workspace/api-zod";

/**
 * Analyses are kept in memory only. They exist so a results screen can reload a
 * session by id and so a retry can compare against the previous attempt; they
 * are intentionally not treated as durable records. The store is bounded so a
 * long-lived dev process cannot grow without limit.
 */
const MAX_SESSIONS = 200;

const sessions = new Map<string, AnalyzeResponse>();

export function saveAnalysis(result: Omit<AnalyzeResponse, "session_id">): AnalyzeResponse {
  const session: AnalyzeResponse = { session_id: randomUUID(), ...result };

  sessions.set(session.session_id, session);

  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;

    if (oldest === undefined) break;

    sessions.delete(oldest);
  }

  return session;
}

export function getAnalysis(id: string): AnalyzeResponse | undefined {
  return sessions.get(id);
}

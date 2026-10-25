# Notes for later steps

Reference ideas deliberately parked instead of half-built. Append only; never rewrite
earlier entries.

## Step 3 — LLM content scoring (from Eloq `services/llm_service.py`)

- `_invoke_json()` attempts the model call **twice** when the reply is not parseable
  JSON (or is not a JSON object), then raises an explicit error. Retry the parse, not
  the whole request, and never answer with a partial object.
- `_clamp_score(value, default)` casts to int, rounds, rejects bool/non-numeric, and
  clamps into 1–10. Adopt the shape of this guard (typed clamp) but **not its default**:
  a missing score must stay `null`/unavailable, never a friendly mid value.
- Anti-pattern to avoid: Eloq's `fallback_evaluation()` returns fixed 7/10 for all four
  scores and three invented feedback lines when the model fails. We return an explicit
  `llm_unavailable` error state instead (the existing `/api/analyze/ideal` already
  behaves that way).
- Anti-pattern to avoid: prompt wording like "be encouraging, most attempts land
  between 6 and 8". It biases every score upward. Anchor prompts to the deterministic
  metrics and ask for evidence per claim.
- Useful detail: request JSON mode (`response_format: {"type": "json_object"}`) and
  strip ```json fences before parsing.

## Step 7 — persistence, retry comparison, progress (from Eloq)

### Retry comparison (`schemas/analysis.py`, `api/practice.py` `POST /retry`)

- Contract: `AttemptSnapshot` = `{wpm, fillers, pauses, fluency_score}`;
  `RetryComparison` = `{original_attempt, current_attempt, improvements}`;
  `RetryResponse` extends the normal analyze response with `comparison`.
- Improvements are pre-formatted signed strings (`"+3.2"`, `"-2"`), which keeps the
  UI dumb but makes them hard to chart. Prefer numeric deltas plus a display helper.
- Flow: retry requires the original session id, rejects a missing original (404),
  caps attempts at 3 (`400 Maximum retries reached`), stores `attempt_number` and
  `original_session_id`, and reuses the original prompt.
- Our existing `/api/analyze/retry` already does the snapshot comparison; it only
  lacks the attempt cap and a durable link between attempts.

### Progress (`services/progress_service.py`)

- `calculate_streak()` walks session dates newest-first and counts consecutive days
  that contain a practice **or** roleplay session; returns 1 for a single day.
- Period windows: `week` / `month` / `all`, with the baseline being the previous
  window (`previous_week`) or, when there is no history, the first session.
- `_percentage_change()` formats deltas for display; `_not_enough_data_payload()`
  returns an explicit "not enough data" shape for empty windows instead of zeros —
  keep that honesty rule.
- `_build_trend()` produces a per-period series for a sparkline.
- Grouped history: sessions grouped by prompt with all attempts, plus per-session
  detail endpoints. Worth copying as a shape once rows exist.

### Persistence fields this implies

Session/prompt identity, audio reference, transcript, duration, wpm, fillers, pauses,
word count, four scores, feedback JSON, grammar mistakes JSON, `attempt_number`,
`original_session_id`, timestamps. No tables until Step 7, per the standing decision.

## Step 4/5 — MultimodalCoach (not read in depth yet)

Parked until those steps are prompted.

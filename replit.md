# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `cd artifacts/asr-service && pip install -r requirements.txt && python app.py` — local transcription service (port 8001)
- `cd artifacts/api-server && node --test tests/*.test.ts` — deterministic metric tests
- `cd artifacts/asr-service && python -m unittest discover -s tests` — ASR validation tests
- `pnpm --filter @workspace/echo-labs run dev` — run the EchoLabs web app (port 5000, LAN-visible)
- `pnpm --filter @workspace/echo-labs run dev:local` — same, bound to localhost only
- Note: a shell that exports `PORT=0` is handled — the app falls back to port 5000 with a warning
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for every HTTP endpoint; run the `api-spec` codegen after editing it
- `lib/api-zod`, `lib/api-client-react` — generated schemas and React hooks (never hand-edit)
- `artifacts/api-server/src/routes/analyze.ts` — analyze endpoints; `src/lib/analysis.ts` holds the metric and score rules
- `artifacts/api-server/src/lib/metrics.ts` — deterministic metrics (WPM, articulation rate, pauses from word timings, word-boundary fillers, lexical diversity); pure, unit-tested
- `artifacts/api-server/src/routes/speech.ts` — `POST /transcribe` (proxies the ASR service) and `POST /analyze/metrics` (re-scores edited text)
- `artifacts/asr-service/` — local faster-whisper service (Python). Required for transcription; see its README
- `artifacts/echo-labs/src/components/voice-lab.tsx` — record/upload, editable transcript, re-score view
- `artifacts/api-server/scripts/smoke-analyze.mjs` — HTTP smoke test for the analyze flow (`node scripts/smoke-analyze.mjs` against a running server)
- `artifacts/echo-labs/src/App.tsx` — the live coaching surface (camera, mic, Web Speech transcript)
- `artifacts/echo-labs/src/lib/realtime-monitor.ts` — the realtime voice monitor: 7s personal baseline, 0.5s blocks, z-score violations, live alerts and the exponential monitor scores
- `.agents/memory/evaluation-integrity.md` — rules for how scores and evidence may be described

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Live delivery coaching in the browser: camera presence, microphone level, speech-to-text transcript, pace and filler tracking.
- `POST /api/analyze` turns a captured transcript plus its measured duration into delivery metrics (words, wpm, fillers, pauses) and 1–10 indicator scores.
- `GET /api/analyze/:id` reloads a stored analysis; `POST /api/analyze/retry` re-scores a second attempt and returns a side-by-side comparison.
- `POST /api/analyze/ideal` returns 503 until a language-model provider is connected — it must not fabricate a model answer.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run codegen after touching `openapi.yaml`; hand-editing the generated Zod/client files is overwritten on the next run.
- Analyses are kept in a bounded in-memory store (200 sessions), so they do not survive a server restart.
- `/api/analyze` still takes the browser transcript and duration. Audio transcription lives at `POST /api/transcribe` and needs the Python ASR service running on port 8001; without it the endpoint returns `503 asr_unavailable` rather than inventing text.
- Word timings are only trusted while they still describe the transcript. Editing the text in the Voice lab drops them, so pauses and articulation rate report "not measured" instead of guessing.
- The OpenAPI spec documents `/transcribe` and `/analyze/metrics`, but codegen has not been run for them: `pnpm`/`orval` are not installed in this environment. Until it is, those endpoints use hand-written types (`lib/metrics.ts`).
- Scores are delivery indicators computed from measurable signals; do not present them as a judgement of communication quality.
- The voice monitor ports its model from a reference research project (MultimodalCoach, `pipelines/audio/realtime_monitor.py`), with Korean copy translated to English. Keep the model constants and the reference's calibration ordering intact when editing it: the calibration pause list is dead code upstream, so `tau` is always the 1.0s fallback. `measureFrame` is the only substituted part — autocorrelation pitch (semitones above 27.5 Hz) and dBFS level replace openSMILE, and an energy gate replaces Silero VAD — because no Python process is available in the browser.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

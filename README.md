# EchoLabs

Speech coaching platform combining deterministic metrics, acoustic analysis, content scoring, timeline events, unified scoring, and event-aware feedback.

## Pipeline Summary

1. **Transcription (Step 1)** - Local faster-whisper (`artifacts/asr-service`) with word timestamps, initial prompt for disfluencies, true audio duration. Returns transcript + word list + duration.
2. **Deterministic Metrics (Step 1)** - WPM (total duration) and articulation rate (pauses removed). Pauses from gaps between consecutive words (>0.8s). Fillers via word-boundary regex (scored: um/uh/er/ah/you know/i mean/sort of/kind of; reported separately: like/so/right/actually/basically/literally). Lexical diversity (moving window TTR), sentence stats.
3. **Acoustics (Step 2)** - Pitch variation via librosa.pyin (semitones), voiced ratio, energy variation (CV), silence via librosa.effects.split (top_db), silence intervals. Failures return null per feature.
4. **Content Scoring (Step 3)** - LLM scores only grammar/vocabulary/structure/relevance (0-10). Rubric with anchors, mode-specific context. JSON with retry/normalize; failures return explicit unavailable state. Editable transcript + re-score.
5. **Events & Unified Scoring (Step 4)** - Timestamped events from real word timestamps: silence (>=0.8s), filler bursts (>=3 in 10s window, merged), repairs/repeats/markers. Unified scoring combines metrics+acoustics+content with named weights/thresholds, pace band 120-160 WPM, tempo stability, speech-to-pause ratio, fluency gating. Event-aware feedback with exercises from patterns.
6. **Body Language (Step 5/6)** - MediaPipe Pose/Face/Hand in frontend. Added Kalman smoothing and 15-frame window aggregation utilities (synthetic tests show jitter reduction).

## Metric Definitions

- **WPM**: (word_count / duration_sec) * 60 over whole recording
- **Articulation rate**: (word_count / speaking_time) * 60 with pauses removed
- **Pauses**: gaps between consecutive words > 0.8s; reports count/total/avg/longest
- **Fillers (scored)**: word-boundary matches for um,uh,er,ah,"you know","i mean","sort of","kind of" (includes elongated forms)
- **Fillers (possible)**: like,so,right,actually,basically,literally (reported separately)
- **Lexical diversity**: moving-average TTR over 50-word windows
- **Pitch variation**: std of log-frequency in semitones (pyin)
- **Energy variation**: coefficient of variation of RMS
- **Silence**: librosa.effects.split with top_db threshold

## Known Limitations

- Video/body language features are additive utilities; full analysis requires implementation per Step 5 requirements
- LLM content scoring requires LLM_API_KEY; failures return explicit unavailable states
- Word timings required for accurate pauses/articulation; edited transcripts may lose timing info
- Thresholds/weights are named constants but not yet validated against human ratings (calibration hooks provided)
- In-memory session store in some paths; DB schema/migrations added but may need DB provisioning
- Korean strings from references must be translated if reused

## Tests

Run tests:
```bash
cd artifacts/api-server && node --test tests/*.test.ts
cd artifacts/asr-service && python -m unittest discover -s tests
pnpm run typecheck
```

## Running the app

This repo contains a Vite React frontend (`artifacts/fusion-coach`) plus an
Express API server and a local Python ASR service. To run the frontend:

```bash
cd artifacts/fusion-coach
npm install
# or `pnpm install` if that is your package manager
npm run dev
```

The frontend expects these environment variables before it starts:

- `VITE_CLERK_PUBLISHABLE_KEY`

Copy `artifacts/fusion-coach/.env.example` to `artifacts/fusion-coach/.env`:

```bash
# from the project root
cp artifacts/fusion-coach/.env.example artifacts/fusion-coach/.env
```

Or use the first-run helper that ships with the frontend:

```bash
# Windows PowerShell
cd artifacts/fusion-coach
.
start-platform.ps1

# macOS / Linux
cd artifacts/fusion-coach
chmod +x start-platform.sh
./start-platform.sh
```

That helper will install dependencies if needed, create a local `.env`,
and start `npm run dev` for you.

If you prefer to set up manually, create `artifacts/fusion-coach/.env` with:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_ZmFpdGhmdWwtZ25hdC03NTY1LmNsZXJrLmFjY291bnRzLmRldiQ
```

The publishable key is not a secret; it is safe to keep in your local `.env`.
It must **not** be committed in plain text.

If you want the same experience on another laptop (Windows or Mac), the goal
is: fresh clone, install deps, drop in a local `.env`, then `npm run dev`.

Quick portability checklist:

1. Install Node.js matching the project’s expected version.
2. Clone the repo or unzip the shipped folder.
3. Install dependencies with the project’s package manager.
4. Create a local `.env` with your Clerk publishable key.
5. Start `artifacts/fusion-coach` with `npm run dev`.
6. If the app talks to a local API server, start that too and point the
   frontend at it.

If any of those steps fail on a new machine, that is the portability bug to fix
next: missing dependency versions, hardcoded paths, or env setup that only works
on one machine.

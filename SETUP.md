# EchoLabs — plug and play setup

Copy the project folder to any Windows, macOS or Linux machine, run the installer
once, then run the launcher. Everything else is automatic.

## Windows

1. Install [Node.js 18+](https://nodejs.org) if it is not already there.
   Optional: Python 3.10+ for local transcription.
2. Double-click **`install.bat`** — installs dependencies, creates `.env`,
   builds the API and (if Python is present) the transcription virtualenv.
3. Double-click **`start_fusion.bat`** — the app opens at
   <http://localhost:5174> and the console window closes itself.
4. Double-click **`stop_fusion.bat`** to shut the background services down.

## macOS

1. Install Node.js 18+ (`brew install node`, or the installer from nodejs.org).
   Optional: `brew install python` for local transcription.
2. Double-click **`install.command`**.
   If macOS blocks it: right-click → Open, or run
   `chmod +x install.command start_fusion.command stop_fusion.command` once.
3. Double-click **`start_fusion.command`** — the app opens at
   <http://localhost:5174> and the Terminal window closes itself.
4. Double-click **`stop_fusion.command`** to stop the background services.

## Linux

```bash
./install.sh
./start_fusion.sh      # http://localhost:5174
./stop_fusion.sh
```

## What the installer sets up

| Step | Detail |
| --- | --- |
| JavaScript deps | `pnpm install` for the workspace, falling back to `npm install` in `artifacts/fusion-coach` |
| Environment | `artifacts/fusion-coach/.env` with the public Clerk publishable key (add your Supabase URL/key there too if you have them) |
| API server | `artifacts/api-server/dist` build, so `/api` requests resolve |
| Transcription | `.venv` inside `artifacts/asr-service` with faster-whisper + librosa (skipped without Python) |

Re-run the installer at any time; it skips work that is already done.
Use `node scripts/fusion/install.mjs --force` to reinstall from scratch.

## Ports and logs

| Service | Port | Log |
| --- | --- | --- |
| Web app | 5174 | `.tmp/logs/web.log` |
| API server | 5002 | `.tmp/logs/api.log` |
| ASR service | 8002 | `.tmp/logs/asr.log` |

The launcher frees those three ports before starting, so a stale run never blocks
a fresh one. Recorded process IDs live in `.tmp/fusion-pids.json`.

## If something does not start

- **Port already in use** — run the stop script, or start again; the launcher
  clears the ports itself.
- **Node missing** — install Node 18+, then re-run the installer.
- **`pnpm` is not installed** — not required: the installer falls back to npm.
  (You can also run `corepack enable` to get pnpm.)
- **Transcription disabled** — Python or its packages are missing. The coaching
  session still works; only server-side transcription is unavailable.
- **Blank page** — check `.tmp/logs/web.log`; the Vite server logs its bind
  address and any build error there.

## Note on the "install button"

A web page cannot install operating-system dependencies on your machine — the
browser sandbox forbids it. The installer files above are the clickable install
step: one double-click (`install.bat` / `install.command`) does the whole setup.

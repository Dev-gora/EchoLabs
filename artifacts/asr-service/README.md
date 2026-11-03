# ASR service

Local speech-to-text for the post-recording flow. The Express API server calls
this service; the browser never talks to it directly.

Python is unavoidable here: faster-whisper (CTranslate2) has no Node binding.
The acoustic delivery module also uses librosa for pYIN pitch, RMS energy and
silence intervals. Everything else in the app stays in the existing TypeScript
workspace.

## Run

```bash
cd artifacts/asr-service
pip install -r requirements.txt
python app.py            # http://127.0.0.1:8001
```

Then start the API server as usual (`artifacts/api-server`, port 5001). Without
this service, `POST /api/transcribe` answers `503 asr_unavailable` — it does not
fall back to a fake transcript.

The first request downloads the model (base ≈ 140 MB) and can take a while.

## Configuration

| Variable | Default | Why |
| --- | --- | --- |
| `WHISPER_MODEL` | `base` | Model size or local path. `tiny` is faster but mis-segments words ("Umm" → "You mm"); `base` keeps fillers intact. |
| `WHISPER_DEVICE` | `cpu` | `cuda` if a GPU build of CTranslate2 is installed. |
| `WHISPER_COMPUTE_TYPE` | `int8` | `int8` is the CPU default; use `float16`/`float32` on GPU. |
| `MIN_AUDIO_SEC` | `30` | Below this, pace/pause/filler rates are not meaningful. |
| `MAX_AUDIO_SEC` | `180` | One answer, not a monologue. |
| `MAX_UPLOAD_BYTES` | `12582912` | 12 MiB ceiling for one request buffer. |
| `ASR_HOST` / `ASR_PORT` | `127.0.0.1` / `8001` | Bind address. |

The API server has its own knobs: `ASR_SERVICE_URL` (default
`http://127.0.0.1:8001`), `ASR_TIMEOUT_MS` (default 120000) and
`MAX_UPLOAD_BYTES`.

## API

`POST /transcribe` — raw audio body, `Content-Type: audio/*`,
`X-Audio-Filename: take.webm`. Returns:

```json{"transcript": "...", "words": [{ "word": "um", "start": 0.4, "end": 0.7 }], "duration_sec": 41.0, "acoustics": {"pitch_variation_semitones": 2.1, "voiced_ratio": 0.72, "energy_variation_cv": 0.31, "silence_ratio": 0.14, "silence_intervals": [{"start": 3.2, "end": 4.1}]}}

```

Errors use `{ "error": "code", "message": "human readable" }` with 400 (format),
413 (size), 422 (no speech, unreadable, duration outside bounds) or 503.

`GET /healthz` — does not load the model.

## Notes

- Audio is decoded to 16 kHz mono float32 with PyAV before the model sees it.
  faster-whisper's own decoder passes `metadata_errors` to `av.open`, which PyAV
  19 rejects, so the samples are prepared here.
- `duration_sec` is counted from decoded samples, never from the last segment, so
  trailing silence still counts toward WPM.
- `vad_filter` is off: trimming silence would make pace look faster than it was.
- Word timings are required. A recording that produces text but no timings is
  rejected, because pauses and articulation rate would otherwise be invented.
- Acoustic fields are independent and nullable. Pitch variation is the standard
  deviation of pYIN frequency in semitone coordinates; voiced ratio is a fraction;
  energy variation is the RMS coefficient of variation; silence ratio and intervals
  are measured with `librosa.effects.split(top_db=40)`. The duration denominator is
  the decoded true audio duration, not the last word timestamp.

## Tests

```bash
python -m unittest discover -s tests
```

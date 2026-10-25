"""HTTP shell around the local whisper model.

The Express API server is the only caller. Audio arrives as a raw request body
with an ``X-Audio-Filename`` header, which avoids multipart parsing on both
sides while still letting the service validate the extension and content type.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from asr import AudioRejected, service_info, transcribe_bytes, validate_upload

app = FastAPI(title="Fusion Coach ASR", version="1.0.0")


@app.get("/healthz")
def healthz() -> dict:
    """Cheap liveness probe. Does not load the model."""
    return {"status": "ok", **service_info()}


@app.exception_handler(AudioRejected)
async def rejected_handler(_request: Request, exc: AudioRejected) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.code, "message": exc.message},
    )


@app.post("/transcribe")
async def transcribe(request: Request) -> dict:
    body = await request.body()
    filename = request.headers.get("x-audio-filename", "")

    suffix = validate_upload(filename, request.headers.get("content-type"), len(body))

    result = await run_in_threadpool(transcribe_bytes, body, suffix)
    return result.as_dict()


@app.get("/")
def root() -> dict:
    return {"service": "fusion-coach-asr", **service_info()}


def main() -> None:
    import os

    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.environ.get("ASR_HOST", "127.0.0.1"),
        port=int(os.environ.get("ASR_PORT", "8001")),
        log_level=os.environ.get("ASR_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()

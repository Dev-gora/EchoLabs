"""Local speech-to-text with faster-whisper.

Everything here is deliberately small and testable: the upload checks and the
result assembly are pure functions, and only ``transcribe_bytes`` touches the
model or the filesystem.

Configuration comes from the environment so the model size and compute type can
be changed without code edits:

    WHISPER_MODEL           base          model size or local path
    WHISPER_DEVICE          cpu           cpu | cuda
    WHISPER_COMPUTE_TYPE    int8          int8 | int8_float16 | float16 | float32
    MIN_AUDIO_SEC           30            shorter uploads are rejected
    MAX_AUDIO_SEC           180           longer uploads are rejected
    MAX_UPLOAD_BYTES        12582912      hard byte ceiling (12 MiB)
"""

from __future__ import annotations

import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

# --- upload policy ---------------------------------------------------------

ALLOWED_EXTENSIONS = {"wav", "webm", "mp3", "m4a", "ogg", "flac"}

ALLOWED_CONTENT_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/webm",
    "video/webm",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/ogg",
    "audio/flac",
    "application/octet-stream",
}

# 12 MiB covers a 3 minute webm/opus take with room to spare, and keeps a single
# request from holding a large buffer in memory.
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 12 * 1024 * 1024))

# Below 30s there is not enough speech for pace, pause or filler rates to mean
# anything; above 3 minutes the session stops being one answer.
MIN_AUDIO_SEC = float(os.environ.get("MIN_AUDIO_SEC", "30"))
MAX_AUDIO_SEC = float(os.environ.get("MAX_AUDIO_SEC", "180"))

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# Whisper is trained on clean transcripts and drops disfluencies unless it is
# primed with some. This prompt is the reference project's trick: the model then
# tends to keep "um", "uh" and "you know" in the output instead of silently
# deleting the very evidence the metrics need.
INITIAL_PROMPT = "Umm, so, uh, I was like, you know, thinking... hmm, well, okay."

# Whisper's native rate. Audio is decoded to mono float32 at 16 kHz before the
# model sees it, so the duration below is counted from real samples rather than
# read back from a container header.
SAMPLE_RATE = 16000


class AudioRejected(Exception):
    """A request the service refuses, with the HTTP status it maps to."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Transcription:
    transcript: str
    words: list[dict[str, Any]]
    duration_sec: float
    acoustics: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "transcript": self.transcript,
            "words": self.words,
            "duration_sec": round(self.duration_sec, 3),
            "acoustics": self.acoustics,
        }


# --- pure validation -------------------------------------------------------


def extension_of(filename: str) -> str:
    return Path(filename or "").suffix.lower().lstrip(".")


def validate_upload(filename: str, content_type: str | None, size: int) -> str:
    """Checks name, declared type and size. Returns the file suffix to use."""
    suffix = extension_of(filename)

    if not suffix:
        raise AudioRejected(400, "invalid_format", "The upload needs a file name with an extension.")

    if suffix not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise AudioRejected(400, "invalid_format", f"Unsupported audio format '.{suffix}'. Allowed: {allowed}.")

    if content_type:
        mime = content_type.split(";")[0].strip().lower()
        if mime not in ALLOWED_CONTENT_TYPES:
            raise AudioRejected(400, "invalid_format", f"Unsupported content type '{mime}'.")

    if size <= 0:
        raise AudioRejected(400, "empty_upload", "The upload was empty.")

    if size > MAX_UPLOAD_BYTES:
        limit_mb = MAX_UPLOAD_BYTES / (1024 * 1024)
        raise AudioRejected(413, "file_too_large", f"The upload is larger than {limit_mb:.0f} MiB.")

    return f".{suffix}"


def validate_duration(duration_sec: float) -> None:
    if duration_sec < MIN_AUDIO_SEC:
        raise AudioRejected(
            422,
            "audio_too_short",
            f"Audio is {duration_sec:.1f}s; at least {MIN_AUDIO_SEC:.0f}s is required.",
        )

    if duration_sec > MAX_AUDIO_SEC:
        raise AudioRejected(
            422,
            "audio_too_long",
            f"Audio is {duration_sec:.1f}s; keep it under {MAX_AUDIO_SEC:.0f}s.",
        )


def build_transcription(
    segments: Iterable[Any],
    duration_sec: float,
) -> Transcription:
    """Assembles words and text from whisper segments.

    The duration is the value the decoder reports for the file, never the end of
    the last segment: trailing silence is part of the take and the metric layer
    needs it to separate pace from articulation.
    """
    words: list[dict[str, Any]] = []
    parts: list[str] = []

    for segment in segments:
        text = (segment.text or "").strip()
        if text:
            parts.append(text)

        for word in getattr(segment, "words", None) or []:
            token = (word.word or "").strip()
            if not token:
                continue
            words.append(
                {
                    "word": token,
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                }
            )

    transcript = " ".join(parts).strip()

    if not transcript or not words:
        raise AudioRejected(
            422,
            "no_speech",
            "No speech was recognised in that recording.",
        )

    return Transcription(transcript=transcript, words=words, duration_sec=duration_sec)


# --- model -----------------------------------------------------------------

_model = None
_model_lock = threading.Lock()


def get_model():
    """Loads the model once. The first call may download weights."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
        return _model


def decode_audio(path: str):
    """Decodes any container PyAV understands to 16 kHz mono float32.

    faster-whisper's own decoder calls ``av.open(..., metadata_errors=...)``,
    which PyAV 19 no longer accepts, so the samples are prepared here and handed
    over as an array. It also means the duration is counted from decoded samples
    instead of trusting a container header.
    """
    import av
    import numpy as np

    chunks = []

    with av.open(path) as container:
        if not container.streams.audio:
            raise AudioRejected(422, "unreadable_audio", "The upload has no audio stream.")

        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)

        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))

    if not chunks:
        raise AudioRejected(422, "unreadable_audio", "No audio samples could be decoded.")

    samples = np.concatenate(chunks).astype("float32")
    duration = len(samples) / SAMPLE_RATE

    if duration <= 0:
        raise AudioRejected(422, "unreadable_audio", "The audio duration could not be read.")

    return samples, duration


def transcribe_bytes(data: bytes, suffix: str) -> Transcription:
    """Transcribes raw audio bytes and always removes its temp file."""
    handle, path = tempfile.mkstemp(suffix=suffix or ".webm")
    try:
        with os.fdopen(handle, "wb") as file_obj:
            file_obj.write(data)

        try:
            samples, duration = decode_audio(path)
        except AudioRejected:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AudioRejected(
                422,
                "unreadable_audio",
                f"The audio could not be decoded: {exc.__class__.__name__}.",
            ) from exc

        validate_duration(duration)

        model = get_model()

        # vad_filter stays off on purpose: the duration must cover the whole take,
        # otherwise trailing silence disappears from the WPM maths.
        segments, _info = model.transcribe(
            samples,
            language="en",
            word_timestamps=True,
            initial_prompt=INITIAL_PROMPT,
            vad_filter=False,
        )

        transcription = build_transcription(list(segments), duration)
        # Keep the temporary source available to the separate acoustic module;
        # it is removed by this function's finally block after all features run.
        from acoustics import analyze_audio

        return Transcription(
            transcript=transcription.transcript,
            words=transcription.words,
            duration_sec=transcription.duration_sec,
            acoustics=analyze_audio(path, duration, samples=samples, sample_rate=SAMPLE_RATE),
        )
    except AudioRejected:
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced as a clean 422 to the caller
        raise AudioRejected(
            422,
            "unreadable_audio",
            f"The audio could not be transcribed: {exc.__class__.__name__}.",
        ) from exc
    finally:
        if os.path.exists(path):
            os.remove(path)


def service_info() -> dict[str, Any]:
    return {
        "model": WHISPER_MODEL,
        "device": WHISPER_DEVICE,
        "compute_type": WHISPER_COMPUTE_TYPE,
        "min_audio_sec": MIN_AUDIO_SEC,
        "max_audio_sec": MAX_AUDIO_SEC,
        "max_upload_bytes": MAX_UPLOAD_BYTES,
    }

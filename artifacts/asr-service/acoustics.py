"""Independent acoustic delivery measurements for a decoded recording.

Every feature is guarded separately: a problem with pYIN does not suppress RMS
or silence measurements. Undefined measurements are represented by ``None``;
no acoustic score or fallback value is produced here.
"""

from __future__ import annotations

from typing import Any

SAMPLE_RATE = 16_000
# A 40 dB range below the loudest sound separates meaningful speech from quiet
# gaps without basing the threshold on the recording's average energy.
SILENCE_TOP_DB = 40
# Broad adult conversational pitch range; frames outside it are not estimated.
PITCH_FMIN_HZ = 65.0
PITCH_FMAX_HZ = 400.0


def _load_audio(path: str):
    import librosa
    import numpy as np

    samples, sample_rate = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    if samples.size == 0 or sample_rate <= 0:
        raise ValueError("No audio samples")
    return samples.astype(np.float32, copy=False), sample_rate


def _pitch_features(samples, sample_rate: int) -> tuple[float | None, float | None]:
    import librosa
    import numpy as np

    # Use a fixed hop_length for consistent frame timing across clips.
    frequencies, _voiced, _probability = librosa.pyin(
        samples,
        fmin=PITCH_FMIN_HZ,
        fmax=PITCH_FMAX_HZ,
        sr=sample_rate,
        hop_length=1024,
    )
    valid = np.isfinite(frequencies) & (frequencies > 0)
    voiced_ratio = float(np.count_nonzero(valid) / frequencies.size) if frequencies.size else None
    if not np.any(valid):
        return None, voiced_ratio

    # Standard deviation in semitone coordinates is pitch variation independent
    # of the speaker's absolute register: 12 * log2(frequency).
    semitones = 12.0 * np.log2(frequencies[valid])
    variation = float(np.std(semitones))
    return variation, voiced_ratio


def _energy_variation(samples) -> float | None:
    import librosa
    import numpy as np

    rms = librosa.feature.rms(y=samples)[0]
    if rms.size == 0:
        return None
    mean = float(np.mean(rms))
    if not np.isfinite(mean) or mean <= 0:
        return None
    value = float(np.std(rms) / mean)
    return value if np.isfinite(value) else None


def _silence_features(samples, sample_rate: int, duration_sec: float) -> tuple[float | None, list[dict[str, float]] | None]:
    import librosa
    import numpy as np

    if not np.isfinite(duration_sec) or duration_sec <= 0:
        return None, None

    # effects.split returns sound intervals; their complement is silence.
    non_silent = librosa.effects.split(samples, top_db=SILENCE_TOP_DB)
    sample_count = int(samples.size)
    if sample_count == 0:
        return None, None

    # librosa compares relative to peak, making an all-zero clip appear wholly
    # non-silent. For that degenerate input, its measured RMS is exactly zero, so
    # correctly interpret the full true duration as silence.
    if not np.any(np.abs(samples) > 0):
        return 1.0, [{"start": 0.0, "end": round(float(duration_sec), 3)}]

    intervals: list[dict[str, float]] = []
    cursor = 0
    for raw_start, raw_end in non_silent:
        start = max(0, min(sample_count, int(raw_start)))
        end = max(start, min(sample_count, int(raw_end)))
        if start > cursor:
            intervals.append({
                "start": round(cursor / sample_rate, 3),
                "end": round(start / sample_rate, 3),
            })
        cursor = max(cursor, end)

    if cursor < sample_count:
        intervals.append({
            "start": round(cursor / sample_rate, 3),
            "end": round(min(float(duration_sec), sample_count / sample_rate), 3),
        })

    decoded_duration = sample_count / sample_rate
    if duration_sec > decoded_duration:
        intervals.append({
            "start": round(decoded_duration, 3),
            "end": round(float(duration_sec), 3),
        })

    # Use Step 1's decoded duration as the denominator (including trailing
    # silence), not the final recognized word's timestamp.
    silence_seconds = sum(max(0.0, item["end"] - item["start"]) for item in intervals)
    ratio = min(1.0, max(0.0, silence_seconds / duration_sec))
    return float(ratio), intervals


def analyze_audio(
    path: str,
    duration_sec: float,
    *,
    samples=None,
    sample_rate: int = SAMPLE_RATE,
) -> dict[str, Any]:
    """Return independent acoustic features for ``path`` using true duration.

    Fields are null individually when their signal cannot be measured. Silence
    intervals are seconds from the start of the audio, with end times clipped to
    the true duration supplied by Step 1.
    """
    result: dict[str, Any] = {
        "pitch_variation_semitones": None,
        "voiced_ratio": None,
        "energy_variation_cv": None,
        "silence_ratio": None,
        "silence_intervals": None,
    }
    if samples is None:
        try:
            samples, sample_rate = _load_audio(path)
        except Exception:
            return result
    else:
        try:
            import numpy as np

            samples = np.asarray(samples, dtype=np.float32)
            if samples.size == 0 or sample_rate <= 0:
                return result
        except Exception:
            return result

    try:
        pitch_variation, voiced_ratio = _pitch_features(samples, sample_rate)
        result["pitch_variation_semitones"] = pitch_variation
        result["voiced_ratio"] = voiced_ratio
    except Exception:
        pass

    try:
        result["energy_variation_cv"] = _energy_variation(samples)
    except Exception:
        pass

    try:
        silence_ratio, silence_intervals = _silence_features(samples, sample_rate, duration_sec)
        result["silence_ratio"] = silence_ratio
        result["silence_intervals"] = silence_intervals
    except Exception:
        pass

    return result

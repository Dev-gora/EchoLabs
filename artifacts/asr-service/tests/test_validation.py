"""Unit tests for the pure parts of the ASR service.

Run from artifacts/asr-service:  python -m unittest discover -s tests
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from asr import (  # noqa: E402
    MAX_UPLOAD_BYTES,
    MIN_AUDIO_SEC,
    AudioRejected,
    build_transcription,
    validate_duration,
    validate_upload,
)


class Segment:
    def __init__(self, text, words=None):
        self.text = text
        self.words = words or []


class Word:
    def __init__(self, word, start, end):
        self.word = word
        self.start = start
        self.end = end


class UploadValidationTests(unittest.TestCase):
    def test_accepts_known_formats(self):
        self.assertEqual(validate_upload("take.webm", "audio/webm", 1000), ".webm")
        self.assertEqual(validate_upload("take.WAV", "audio/wav", 1000), ".wav")

    def test_rejects_missing_or_unknown_extension(self):
        with self.assertRaises(AudioRejected) as missing:
            validate_upload("take", "audio/webm", 1000)
        self.assertEqual(missing.exception.status_code, 400)

        with self.assertRaises(AudioRejected) as unknown:
            validate_upload("take.mid", "audio/midi", 1000)
        self.assertEqual(unknown.exception.code, "invalid_format")

    def test_rejects_unlisted_content_type(self):
        with self.assertRaises(AudioRejected) as ctx:
            validate_upload("take.webm", "text/plain", 1000)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_empty_and_oversized_uploads(self):
        with self.assertRaises(AudioRejected) as empty:
            validate_upload("take.webm", "audio/webm", 0)
        self.assertEqual(empty.exception.code, "empty_upload")

        with self.assertRaises(AudioRejected) as large:
            validate_upload("take.webm", "audio/webm", MAX_UPLOAD_BYTES + 1)
        self.assertEqual(large.exception.status_code, 413)


class DurationTests(unittest.TestCase):
    def test_bounds(self):
        validate_duration(MIN_AUDIO_SEC)

        with self.assertRaises(AudioRejected) as short:
            validate_duration(MIN_AUDIO_SEC - 1)
        self.assertEqual(short.exception.code, "audio_too_short")

        with self.assertRaises(AudioRejected) as long:
            validate_duration(10_000)
        self.assertEqual(long.exception.code, "audio_too_long")


class AssemblyTests(unittest.TestCase):
    def test_collects_words_and_text(self):
        segments = [
            Segment(" Umm, so ", [Word(" Umm,", 0.0, 0.4), Word(" so", 0.5, 0.8)]),
            Segment("uh yes.", [Word(" uh", 1.9, 2.2), Word(" yes.", 2.3, 2.7)]),
        ]

        result = build_transcription(segments, 12.0)

        self.assertEqual(result.transcript, "Umm, so uh yes.")
        self.assertEqual([w["word"] for w in result.words], ["Umm,", "so", "uh", "yes."])
        self.assertEqual(result.words[3]["end"], 2.7)
        # The reported duration is the file's, not the last word's end.
        self.assertEqual(result.duration_sec, 12.0)

    def test_empty_transcript_is_rejected(self):
        with self.assertRaises(AudioRejected) as ctx:
            build_transcription([Segment("   ")], 30.0)
        self.assertEqual(ctx.exception.code, "no_speech")

    def test_segments_without_words_are_rejected(self):
        """Word timings are required; a transcript alone cannot drive the metrics."""
        with self.assertRaises(AudioRejected):
            build_transcription([Segment("hello there", [])], 30.0)


if __name__ == "__main__":
    unittest.main()

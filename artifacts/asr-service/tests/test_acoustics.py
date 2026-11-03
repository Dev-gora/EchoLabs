"""Synthetic signals for local acoustic measurements.

Run with: python -m unittest discover -s tests
"""

import sys
import unittest
from unittest.mock import patch

import numpy as np

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from acoustics import analyze_audio

SAMPLE_RATE = 16_000


class AcousticAnalysisTests(unittest.TestCase):
    def analyze(self, samples: np.ndarray, true_duration: float | None = None):
        samples = np.asarray(samples, dtype=np.float32)
        duration = len(samples) / SAMPLE_RATE if true_duration is None else true_duration
        return analyze_audio("", duration, samples=samples, sample_rate=SAMPLE_RATE)

    def tone(self, frequency: float, duration: float, amplitude: float = 0.3) -> np.ndarray:
        time = np.arange(round(duration * SAMPLE_RATE), dtype=np.float32) / SAMPLE_RATE
        return amplitude * np.sin(2 * np.pi * frequency * time)

    def test_constant_tone_has_near_zero_pitch_variation(self):
        features = self.analyze(self.tone(220, 2.0))
        self.assertIsNotNone(features["pitch_variation_semitones"])
        self.assertLess(features["pitch_variation_semitones"], 0.5)
        self.assertGreater(features["voiced_ratio"], 0.8)

    def test_alternating_tones_have_higher_pitch_variation(self):
        low = self.tone(120, 0.5)
        high = self.tone(300, 0.5)
        alternating = np.concatenate([low, high, low, high])
        constant = self.tone(200, 2.0)

        varied_features = self.analyze(alternating)
        constant_features = self.analyze(constant)
        self.assertIsNotNone(varied_features["pitch_variation_semitones"])
        self.assertGreater(
            varied_features["pitch_variation_semitones"],
            constant_features["pitch_variation_semitones"] + 2.0,
        )

    def test_silence_only_has_null_pitch_and_energy_no_crash(self):
        features = self.analyze(np.zeros(SAMPLE_RATE, dtype=np.float32))
        self.assertIsNone(features["pitch_variation_semitones"])
        self.assertEqual(features["voiced_ratio"], 0.0)
        self.assertIsNone(features["energy_variation_cv"])
        self.assertEqual(features["silence_ratio"], 1.0)
        self.assertEqual(features["silence_intervals"], [{"start": 0.0, "end": 1.0}])

    def test_subsecond_clip_returns_feature_dict(self):
        samples = self.tone(180, 0.35)
        self.assertLess(len(samples) / SAMPLE_RATE, 1.0)
        features = self.analyze(samples)
        self.assertEqual(set(features), {
            "pitch_variation_semitones", "voiced_ratio", "energy_variation_cv",
            "silence_ratio", "silence_intervals",
        })
        self.assertIsNotNone(features["energy_variation_cv"])

    def test_pitch_failure_does_not_suppress_energy_or_silence(self):
        samples = self.tone(220, 1.0)
        with patch("acoustics._pitch_features", side_effect=RuntimeError("synthetic pYIN failure")):
            features = analyze_audio("", 1.0, samples=samples, sample_rate=SAMPLE_RATE)

        self.assertIsNone(features["pitch_variation_semitones"])
        self.assertIsNone(features["voiced_ratio"])
        self.assertIsNotNone(features["energy_variation_cv"])
        self.assertIsNotNone(features["silence_ratio"])

    def test_silence_ratio_uses_true_duration_including_trailing_silence(self):
        samples = self.tone(220, 1.0)
        # Declared duration beyond decoded samples represents trailing silence.
        features = self.analyze(samples, true_duration=2.0)
        self.assertAlmostEqual(features["silence_ratio"], 0.5, delta=0.08)
        self.assertEqual(features["silence_intervals"][-1]["end"], 2.0)


if __name__ == "__main__":
    unittest.main()

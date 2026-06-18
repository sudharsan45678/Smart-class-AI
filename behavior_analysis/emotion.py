"""
===================================================
Emotion Analyzer — CNN-based Emotion Detection
===================================================
Uses a pre-trained FER (Facial Expression Recognition)
model to classify emotions from face crops.

Supported emotions:
  Happy, Sad, Neutral, Angry, Surprise, Fear, Disgust

Falls back to a simplified heuristic-based approach
if TensorFlow/FER is not available (demo mode).
===================================================
"""

import cv2
import numpy as np
from dataclasses import dataclass
from typing import Optional

# ── Try to import FER (uses TensorFlow) ──────────────────────────────────────
try:
    from fer import FER
    FER_AVAILABLE = True
except ImportError:
    FER_AVAILABLE = False
    print("[WARNING] FER not installed. Emotion detection will use demo mode.")
    print("         Install with: pip install fer tensorflow")


# ── Emotion labels ───────────────────────────────────────────────────────────
EMOTION_LABELS = ["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]

EMOTION_EMOJI = {
    "happy":    "😊",
    "sad":      "😢",
    "angry":    "😠",
    "neutral":  "😐",
    "surprise": "😲",
    "fear":     "😨",
    "disgust":  "🤢",
    "bored":    "😕",
}

# Map FER emotions to SmartClass-friendly labels
EMOTION_MAP = {
    "happy":    "😊 Happy",
    "sad":      "😴 Tired",
    "angry":    "😕 Bored",
    "neutral":  "😐 Neutral",
    "surprise": "🧐 Focused",
    "fear":     "🤔 Confused",
    "disgust":  "😕 Bored",
}


@dataclass
class EmotionResult:
    """Result from emotion analysis of a single face."""
    dominant_emotion: str = "neutral"
    dominant_label: str = "😐 Neutral"
    confidence: float = 0.0
    scores: dict = None  # All emotion probabilities

    def __post_init__(self):
        if self.scores is None:
            self.scores = {e: 0.0 for e in EMOTION_LABELS}


class EmotionAnalyzer:
    """
    Analyzes facial expressions to determine student emotions.

    Uses FER library (pre-trained CNN on FER2013 dataset) when available,
    otherwise falls back to demo mode with random but realistic data.

    Usage:
        analyzer = EmotionAnalyzer()
        result = analyzer.analyze(face_crop_bgr)
        print(f"Emotion: {result.dominant_label} ({result.confidence:.0%})")
    """

    def __init__(self, use_mtcnn: bool = False):
        """
        Initialize the emotion analyzer.

        Args:
            use_mtcnn: Whether to use MTCNN for face detection inside FER.
                      Set to False for speed (assumes face is already cropped).
        """
        self.detector = None
        if FER_AVAILABLE:
            try:
                # mtcnn=False means we supply pre-cropped faces (faster)
                self.detector = FER(mtcnn=use_mtcnn)
                print("[Emotion] FER detector initialized ✓")
            except Exception as e:
                print(f"[Emotion] Could not init FER: {e}. Using demo mode.")

    def analyze(self, face_image: np.ndarray) -> EmotionResult:
        """
        Analyze a face image for emotion.

        Args:
            face_image: BGR cropped face image (numpy array)

        Returns:
            EmotionResult with dominant emotion and all scores
        """
        if face_image is None or face_image.size == 0:
            return EmotionResult()

        # Ensure image is large enough
        h, w = face_image.shape[:2]
        if h < 20 or w < 20:
            return EmotionResult()

        if self.detector is not None:
            return self._analyze_with_fer(face_image)
        else:
            return self._analyze_demo(face_image)

    def _analyze_with_fer(self, face_image: np.ndarray) -> EmotionResult:
        """Use FER library for real emotion detection."""
        try:
            results = self.detector.detect_emotions(face_image)
            if not results:
                return EmotionResult()

            # Take the first (most confident) face
            emotions = results[0]["emotions"]
            dominant = max(emotions, key=emotions.get)
            confidence = emotions[dominant]

            return EmotionResult(
                dominant_emotion=dominant,
                dominant_label=EMOTION_MAP.get(dominant, f"😐 {dominant.capitalize()}"),
                confidence=confidence,
                scores=emotions,
            )
        except Exception as e:
            print(f"[Emotion] FER analysis error: {e}")
            return self._analyze_demo(face_image)

    def _analyze_demo(self, face_image: np.ndarray) -> EmotionResult:
        """
        Heuristic-based emotion estimation from face brightness and contrast.
        This is a simplified demo fallback — NOT accurate, but provides
        realistic-looking scores for demonstration purposes.
        """
        import random
        h, w = face_image.shape[:2]

        # Convert to grayscale for analysis
        if len(face_image.shape) == 3:
            gray = cv2.cvtColor(face_image, cv2.COLOR_BGR2GRAY)
        else:
            gray = face_image

        # Use basic image statistics as a seed for "emotion"
        brightness = np.mean(gray) / 255.0
        contrast = np.std(gray) / 128.0

        # Generate somewhat realistic emotion scores
        base_scores = {
            "happy":    max(0, brightness * 0.5 + random.uniform(0, 0.3)),
            "sad":      max(0, (1 - brightness) * 0.3 + random.uniform(0, 0.2)),
            "angry":    max(0, contrast * 0.2 + random.uniform(0, 0.15)),
            "neutral":  max(0, 0.3 + random.uniform(0, 0.4)),
            "surprise": max(0, contrast * 0.3 + random.uniform(0, 0.2)),
            "fear":     max(0, random.uniform(0, 0.15)),
            "disgust":  max(0, random.uniform(0, 0.1)),
        }

        # Normalize to sum to 1
        total = sum(base_scores.values())
        if total > 0:
            base_scores = {k: v / total for k, v in base_scores.items()}

        dominant = max(base_scores, key=base_scores.get)
        return EmotionResult(
            dominant_emotion=dominant,
            dominant_label=EMOTION_MAP.get(dominant, "😐 Neutral"),
            confidence=base_scores[dominant],
            scores=base_scores,
        )

    def analyze_frame(self, frame: np.ndarray, face_bboxes: list) -> list:
        """
        Analyze emotions for multiple face bounding boxes in a frame.

        Args:
            frame: Full BGR frame
            face_bboxes: List of (x, y, w, h) tuples

        Returns:
            List of EmotionResult for each face
        """
        results = []
        for (x, y, w, h) in face_bboxes:
            # Ensure bounds are valid
            fh, fw = frame.shape[:2]
            x1, y1 = max(0, x), max(0, y)
            x2, y2 = min(fw, x + w), min(fh, y + h)

            if x2 - x1 < 20 or y2 - y1 < 20:
                results.append(EmotionResult())
                continue

            crop = frame[y1:y2, x1:x2]
            results.append(self.analyze(crop))

        return results

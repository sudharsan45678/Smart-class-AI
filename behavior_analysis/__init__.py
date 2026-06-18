"""
Behavior Analysis Module
========================
Standalone Python module for real-time student behavior analysis
using OpenCV and MediaPipe. This module can run independently
of the web frontend for desktop-based analysis.
"""

from .detector import BehaviorDetector
from .emotion import EmotionAnalyzer

__all__ = ["BehaviorDetector", "EmotionAnalyzer"]

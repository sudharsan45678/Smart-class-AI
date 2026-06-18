"""
Speech-to-Text Module
=====================
Provides audio transcription using:
  1. OpenAI Whisper (offline, local)
  2. Google Speech Recognition (online, fallback)
  3. Web Speech API (browser-based, in frontend)
"""

from .transcriber import SpeechTranscriber

__all__ = ["SpeechTranscriber"]

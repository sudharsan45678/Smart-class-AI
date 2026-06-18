"""
===================================================
Speech Transcriber — Whisper + Google Fallback
===================================================
Converts speech audio to text using:
  1. OpenAI Whisper (local, offline, most accurate)
  2. Google Speech Recognition (online fallback)

Works with both audio files and real-time microphone.
===================================================
"""

import os
import time
import tempfile
from typing import Optional
from dataclasses import dataclass, field

# ── Try Whisper ──────────────────────────────────────────────────────────────
try:
    import whisper
    WHISPER_AVAILABLE = True
    print("[Speech] OpenAI Whisper available ✓")
except ImportError:
    WHISPER_AVAILABLE = False
    print("[Speech] Whisper not installed. Using Google Speech fallback.")

# ── Try SpeechRecognition ────────────────────────────────────────────────────
try:
    import speech_recognition as sr
    SR_AVAILABLE = True
except ImportError:
    SR_AVAILABLE = False
    print("[Speech] SpeechRecognition not installed.")


@dataclass
class TranscriptionResult:
    """Result from speech-to-text transcription."""
    text: str = ""
    language: str = "en"
    duration_seconds: float = 0.0
    engine_used: str = "none"
    confidence: float = 0.0
    word_count: int = 0
    segments: list = field(default_factory=list)  # Whisper segments with timestamps

    def __post_init__(self):
        self.word_count = len(self.text.split()) if self.text else 0


class SpeechTranscriber:
    """
    Multi-engine speech-to-text transcriber.

    Supports:
      - Whisper (offline, most accurate, supports 99+ languages)
      - Google Speech Recognition (online, free tier)

    Usage:
        transcriber = SpeechTranscriber(engine="whisper", model_size="base")

        # From an audio file
        result = transcriber.transcribe_file("lecture.wav")
        print(result.text)

        # From microphone (real-time, 10 second chunks)
        result = transcriber.transcribe_microphone(duration=10)
        print(result.text)
    """

    def __init__(
        self,
        engine: str = "auto",
        model_size: str = "base",
        language: str = "en",
    ):
        """
        Initialize the transcriber.

        Args:
            engine: "whisper", "google", or "auto" (tries whisper first)
            model_size: Whisper model size: "tiny", "base", "small", "medium"
                       "tiny" = fastest, least accurate
                       "base" = good balance for laptops
                       "small/medium" = more accurate, needs more RAM
            language: Language code (e.g., "en", "hi", "ta")
        """
        self.language = language
        self.whisper_model = None
        self.recognizer = None

        # Auto-select engine
        if engine == "auto":
            if WHISPER_AVAILABLE:
                engine = "whisper"
            elif SR_AVAILABLE:
                engine = "google"
            else:
                engine = "none"
                print("[Speech] No speech engine available! Install whisper or SpeechRecognition.")

        self.engine = engine

        # Load Whisper model
        if engine == "whisper" and WHISPER_AVAILABLE:
            print(f"[Speech] Loading Whisper model '{model_size}'... (this may take a moment)")
            try:
                self.whisper_model = whisper.load_model(model_size)
                print(f"[Speech] Whisper '{model_size}' loaded ✓")
            except Exception as e:
                print(f"[Speech] Failed to load Whisper: {e}")
                self.engine = "google" if SR_AVAILABLE else "none"

        # Initialize Google Speech
        if engine == "google" or (self.engine == "google" and SR_AVAILABLE):
            self.recognizer = sr.Recognizer()
            print("[Speech] Google Speech Recognition ready ✓")

    def transcribe_file(self, audio_path: str) -> TranscriptionResult:
        """
        Transcribe an audio file to text.

        Supports: WAV, MP3, M4A, FLAC, OGG, and other formats.

        Args:
            audio_path: Path to the audio file

        Returns:
            TranscriptionResult with transcribed text
        """
        if not os.path.exists(audio_path):
            return TranscriptionResult(text=f"Error: File not found: {audio_path}")

        start_time = time.time()

        if self.engine == "whisper" and self.whisper_model:
            result = self._whisper_file(audio_path)
        elif self.engine == "google" and self.recognizer:
            result = self._google_file(audio_path)
        else:
            result = TranscriptionResult(
                text="[Demo mode] No speech engine available. "
                     "Install openai-whisper or SpeechRecognition.",
                engine_used="demo",
            )

        result.duration_seconds = round(time.time() - start_time, 2)
        return result

    def transcribe_microphone(self, duration: int = 10) -> TranscriptionResult:
        """
        Record from microphone and transcribe.

        Args:
            duration: Recording duration in seconds

        Returns:
            TranscriptionResult with transcribed text
        """
        if not SR_AVAILABLE:
            return TranscriptionResult(
                text="[Error] SpeechRecognition is required for microphone input. "
                     "Install with: pip install SpeechRecognition pyaudio",
                engine_used="none",
            )

        recognizer = self.recognizer or sr.Recognizer()
        start_time = time.time()

        try:
            with sr.Microphone() as source:
                print(f"[Speech] Adjusting for ambient noise...")
                recognizer.adjust_for_ambient_noise(source, duration=1)
                print(f"[Speech] Recording for {duration} seconds... Speak now!")
                audio = recognizer.listen(source, timeout=duration + 5, phrase_time_limit=duration)
                print("[Speech] Recording complete. Processing...")

            # Try Whisper first if available
            if self.engine == "whisper" and self.whisper_model:
                # Save audio to temp file for Whisper
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    f.write(audio.get_wav_data())
                    temp_path = f.name
                result = self._whisper_file(temp_path)
                os.unlink(temp_path)
            else:
                # Use Google
                result = self._google_audio(audio)

            result.duration_seconds = round(time.time() - start_time, 2)
            return result

        except sr.WaitTimeoutError:
            return TranscriptionResult(
                text="[Timeout] No speech detected within the time limit.",
                engine_used=self.engine,
            )
        except Exception as e:
            return TranscriptionResult(
                text=f"[Error] Microphone recording failed: {e}",
                engine_used=self.engine,
            )

    def _whisper_file(self, audio_path: str) -> TranscriptionResult:
        """Transcribe using Whisper."""
        try:
            result = self.whisper_model.transcribe(
                audio_path,
                language=self.language if self.language != "auto" else None,
                fp16=False,  # Use FP32 for CPU compatibility
            )
            segments = [
                {
                    "start": round(s["start"], 2),
                    "end": round(s["end"], 2),
                    "text": s["text"].strip(),
                }
                for s in result.get("segments", [])
            ]
            return TranscriptionResult(
                text=result["text"].strip(),
                language=result.get("language", self.language),
                engine_used="whisper",
                confidence=0.95,  # Whisper doesn't provide per-result confidence
                segments=segments,
            )
        except Exception as e:
            return TranscriptionResult(
                text=f"[Error] Whisper transcription failed: {e}",
                engine_used="whisper",
            )

    def _google_file(self, audio_path: str) -> TranscriptionResult:
        """Transcribe an audio file using Google Speech Recognition."""
        try:
            with sr.AudioFile(audio_path) as source:
                audio = self.recognizer.record(source)
            return self._google_audio(audio)
        except Exception as e:
            return TranscriptionResult(
                text=f"[Error] Google Speech failed: {e}",
                engine_used="google",
            )

    def _google_audio(self, audio) -> TranscriptionResult:
        """Transcribe audio data using Google Speech Recognition."""
        try:
            text = self.recognizer.recognize_google(
                audio,
                language=self.language,
            )
            return TranscriptionResult(
                text=text,
                language=self.language,
                engine_used="google",
                confidence=0.85,
            )
        except sr.UnknownValueError:
            return TranscriptionResult(
                text="[No speech detected] Could not understand audio.",
                engine_used="google",
            )
        except sr.RequestError as e:
            return TranscriptionResult(
                text=f"[Error] Google API error: {e}",
                engine_used="google",
            )

    @staticmethod
    def list_engines() -> dict:
        """Return available speech engines and their status."""
        return {
            "whisper": {
                "available": WHISPER_AVAILABLE,
                "description": "OpenAI Whisper (local, offline, most accurate)",
                "install": "pip install openai-whisper",
            },
            "google": {
                "available": SR_AVAILABLE,
                "description": "Google Speech Recognition (online, free)",
                "install": "pip install SpeechRecognition",
            },
            "web_speech_api": {
                "available": True,  # Always available in Chrome/Edge
                "description": "Browser Web Speech API (real-time, in frontend)",
                "install": "Built into the web dashboard",
            },
        }

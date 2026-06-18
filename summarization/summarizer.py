"""
===================================================
Lecture Summarizer — Transformer-based NLP
===================================================
Summarizes lecture transcripts using:
  1. HuggingFace T5 model (abstractive summarization)
  2. Extractive summarization (TF-IDF based, no-GPU fallback)

Also extracts key concepts and generates Q&A pairs.
===================================================
"""

import re
import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

# ── Try HuggingFace Transformers ─────────────────────────────────────────────
try:
    from transformers import pipeline
    TRANSFORMERS_AVAILABLE = True
    print("[Summary] HuggingFace Transformers available ✓")
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    print("[Summary] Transformers not installed. Using extractive summarization.")


@dataclass
class SummaryResult:
    """Result from lecture summarization."""
    summary: str = ""
    key_points: list = field(default_factory=list)
    keywords: list = field(default_factory=list)
    qa_pairs: list = field(default_factory=list)
    word_count: int = 0
    engine_used: str = "extractive"

    def __post_init__(self):
        self.word_count = len(self.summary.split()) if self.summary else 0


# ── English stop words ──────────────────────────────────────────────────────
STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "by", "is", "are", "was", "were", "be", "been", "being", "have",
    "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "shall", "can", "that", "this", "these", "those", "it",
    "its", "we", "they", "he", "she", "you", "i", "my", "your", "our", "their",
    "as", "from", "into", "than", "then", "there", "here", "where", "when",
    "which", "who", "what", "how", "if", "so", "also", "both", "each", "more",
    "other", "same", "such", "very", "just", "about", "between", "through",
    "during", "before", "after", "above", "below", "let", "look", "called",
    "first", "second", "third", "two", "three", "four", "five", "six", "seven",
    "one", "all", "any", "few", "most", "some", "no", "not", "only", "own",
}


class LectureSummarizer:
    """
    Multi-engine lecture summarizer.

    Uses T5 (abstractive) when Transformers is available,
    falls back to extractive TF-IDF summarization otherwise.

    Usage:
        summarizer = LectureSummarizer()
        result = summarizer.summarize(lecture_text, topic="Machine Learning")
        print(result.summary)
        print(result.key_points)
    """

    def __init__(self, model_name: str = "t5-small", use_transformers: bool = True):
        """
        Initialize the summarizer.

        Args:
            model_name: HuggingFace model name for abstractive summary.
                       Options: "t5-small" (fast), "t5-base" (better), "facebook/bart-large-cnn"
            use_transformers: Whether to try loading the Transformers pipeline.
        """
        self.summarizer_pipeline = None

        if use_transformers and TRANSFORMERS_AVAILABLE:
            try:
                print(f"[Summary] Loading model '{model_name}'...")
                self.summarizer_pipeline = pipeline(
                    "summarization",
                    model=model_name,
                    tokenizer=model_name,
                )
                print(f"[Summary] Model '{model_name}' loaded ✓")
            except Exception as e:
                print(f"[Summary] Could not load model: {e}. Using extractive mode.")

    def summarize(
        self,
        text: str,
        topic: str = "Lecture",
        max_length: int = 200,
        min_length: int = 50,
        num_key_points: int = 6,
        num_keywords: int = 15,
    ) -> SummaryResult:
        """
        Summarize lecture text and extract key concepts.

        Args:
            text: Raw lecture text
            topic: Topic title for context
            max_length: Maximum summary length (in tokens)
            min_length: Minimum summary length (in tokens)
            num_key_points: Number of key points to extract
            num_keywords: Number of keywords to extract

        Returns:
            SummaryResult with summary, key points, keywords, and Q&A
        """
        if not text or len(text.strip()) < 30:
            return SummaryResult(summary="Text too short to summarize.")

        # ── Extract keywords ────────────────────────────────────────────
        keywords = self._extract_keywords(text, top_n=num_keywords)

        # ── Generate summary ────────────────────────────────────────────
        if self.summarizer_pipeline:
            summary = self._abstractive_summary(text, max_length, min_length)
            engine = "t5"
        else:
            summary = self._extractive_summary(text, num_sentences=5)
            engine = "extractive"

        # ── Extract key points ──────────────────────────────────────────
        key_points = self._extract_key_points(text, num_key_points)

        # ── Generate Q&A pairs ──────────────────────────────────────────
        qa_pairs = self._generate_qa(text, topic, keywords)

        return SummaryResult(
            summary=summary,
            key_points=key_points,
            keywords=keywords,
            qa_pairs=qa_pairs,
            engine_used=engine,
        )

    def _abstractive_summary(self, text: str, max_length: int, min_length: int) -> str:
        """Generate abstractive summary using T5/BART."""
        try:
            # T5 requires "summarize: " prefix
            input_text = f"summarize: {text}"

            # Truncate if too long (T5-small max is 512 tokens)
            words = input_text.split()
            if len(words) > 450:
                input_text = " ".join(words[:450])

            result = self.summarizer_pipeline(
                input_text,
                max_length=max_length,
                min_length=min_length,
                do_sample=False,
                num_beams=4,
            )
            return result[0]["summary_text"].strip()
        except Exception as e:
            print(f"[Summary] Abstractive failed: {e}, falling back to extractive")
            return self._extractive_summary(text)

    def _extractive_summary(self, text: str, num_sentences: int = 5) -> str:
        """
        Extractive summarization using TF-IDF scoring.

        Selects the most important sentences based on term frequency.
        """
        sentences = self._split_sentences(text)
        if len(sentences) <= num_sentences:
            return text.strip()

        # Calculate TF-IDF-like scores for each sentence
        word_freq = Counter()
        for sent in sentences:
            words = self._tokenize(sent)
            word_freq.update(words)

        # Score each sentence
        scored = []
        for i, sent in enumerate(sentences):
            words = self._tokenize(sent)
            if not words:
                scored.append((i, 0))
                continue
            score = sum(word_freq[w] for w in words) / len(words)
            # Boost first and early sentences (positional bias)
            position_boost = 1.0 + (0.3 if i < 3 else 0.0)
            # Boost longer sentences (more info)
            length_boost = min(1.3, len(words) / 15.0)
            scored.append((i, score * position_boost * length_boost))

        # Select top sentences, maintain original order
        scored.sort(key=lambda x: -x[1])
        selected = sorted([s[0] for s in scored[:num_sentences]])

        return " ".join(sentences[i] for i in selected)

    def _extract_keywords(self, text: str, top_n: int = 15) -> list:
        """Extract keywords using TF-based ranking with noun phrase detection."""
        words = re.findall(r"[a-zA-Z]{3,}", text.lower())
        freq = Counter(w for w in words if w not in STOP_WORDS)

        # Boost capitalized terms (likely proper nouns / key terms)
        noun_phrases = re.findall(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b", text)
        for phrase in noun_phrases:
            clean = phrase.strip()
            if len(clean) > 3:
                freq[clean.lower()] += 3

        # Build final keyword list
        seen = set()
        keywords = []
        for word, count in freq.most_common(top_n * 2):
            # Capitalize nicely
            title = word.capitalize()
            if title.lower() not in seen:
                seen.add(title.lower())
                keywords.append(title)
            if len(keywords) >= top_n:
                break

        return keywords

    def _extract_key_points(self, text: str, num_points: int = 6) -> list:
        """Extract key points from the text."""
        sentences = self._split_sentences(text)
        if not sentences:
            return []

        # Score sentences by keyword density
        keywords_set = set(w.lower() for w in self._extract_keywords(text, 20))
        scored = []
        for sent in sentences:
            words = self._tokenize(sent)
            if len(words) < 5:
                continue
            keyword_count = sum(1 for w in words if w in keywords_set)
            score = keyword_count / len(words) if words else 0
            scored.append((sent.strip(), score))

        scored.sort(key=lambda x: -x[1])
        return [s[0] for s in scored[:num_points]]

    def _generate_qa(self, text: str, topic: str, keywords: list) -> list:
        """Generate question-answer pairs from content."""
        sentences = [s.strip() for s in self._split_sentences(text) if len(s.strip()) > 40]

        def pick(idx):
            return sentences[idx] if idx < len(sentences) else "See lecture notes for details."

        qa = [
            {"q": f"What is the main topic of this lecture?",
             "a": f"The lecture covers {topic}, discussing fundamental concepts and principles."},
            {"q": "What are the key concepts introduced?",
             "a": f"Key concepts include: {', '.join(keywords[:5])}."},
        ]

        if len(sentences) > 2:
            qa.append({"q": "Explain the first core principle discussed.",
                       "a": pick(0)})
        if len(sentences) > 4:
            qa.append({"q": f"How do the core mechanisms work in {topic}?",
                       "a": pick(len(sentences) // 4)})
        if len(sentences) > 6:
            qa.append({"q": f"What practical applications are relevant to {topic}?",
                       "a": pick(len(sentences) // 3)})
        if len(sentences) > 8:
            qa.append({"q": f"What challenges or limitations exist in {topic}?",
                       "a": pick(len(sentences) // 2)})

        return qa

    @staticmethod
    def _split_sentences(text: str) -> list:
        """Split text into sentences."""
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        return [s for s in sentences if len(s.strip()) > 10]

    @staticmethod
    def _tokenize(text: str) -> list:
        """Simple word tokenization."""
        return [w.lower() for w in re.findall(r"[a-zA-Z]{3,}", text)
                if w.lower() not in STOP_WORDS]

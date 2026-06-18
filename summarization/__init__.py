"""
Summarization Module
====================
Provides text summarization and key point extraction using:
  1. HuggingFace Transformers (T5/BART)
  2. Extractive summarization (TF-IDF based fallback)
"""

from .summarizer import LectureSummarizer

__all__ = ["LectureSummarizer"]

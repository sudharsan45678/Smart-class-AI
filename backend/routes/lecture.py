"""
===================================================
SmartClass AI — Lecture Note Engine Routes
===================================================
Endpoints:
  POST /api/lecture/process   → run NLP analysis, save to SQLite
  GET  /api/lecture           → list all saved lectures
  GET  /api/lecture/<id>      → full lecture + concepts + Q&A
  DELETE /api/lecture/<id>    → remove a lecture
  GET  /api/lecture/<id>/export → plain-text export
"""

import re
import textwrap
from datetime import datetime
from flask import Blueprint, request, jsonify
from database import get_db, row_to_dict, rows_to_list

lecture_bp = Blueprint("lecture", __name__)

# ── English stop-words (compact list) ────────────────────────────────────────
STOP_WORDS = {
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","is","are","was","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might","shall",
    "can","that","this","these","those","it","its","we","they","he","she",
    "you","i","my","your","our","their","as","from","into","than","then",
    "there","here","where","when","which","who","what","how","if","so",
    "also","both","each","more","other","same","such","very","just","about",
    "between","through","during","before","after","above","below","between",
    "through","during","before","after","above","below","let","look","called",
    "first","second","third","two","three","four","five","six","seven","eight",
    "one","all","any","few","most","some","no","not","only","own","same",
}


# ─────────────────────────────────────────────────────────────────────────────
# NLP HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def extract_keywords(text: str, top_n: int = 18) -> list[str]:
    """TF-style keyword extraction without external libraries."""
    words = re.findall(r"[a-zA-Z]{3,}", text.lower())
    freq: dict[str, int] = {}
    for w in words:
        if w not in STOP_WORDS:
            freq[w] = freq.get(w, 0) + 1

    # Prefer capitalised noun-phrases found in original text
    noun_phrases = re.findall(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b", text)
    phrase_score: dict[str, int] = {}
    for phrase in noun_phrases:
        clean = phrase.strip()
        if len(clean) > 3:
            phrase_score[clean] = phrase_score.get(clean, 0) + 2

    # Merge
    combined: dict[str, int] = {}
    for word, cnt in freq.items():
        title = word.capitalize()
        combined[title] = combined.get(title, 0) + cnt
    for phrase, score in phrase_score.items():
        combined[phrase] = combined.get(phrase, 0) + score

    sorted_kw = sorted(combined.items(), key=lambda x: -x[1])
    # Deduplicate (keep longest form)
    seen_lower: set[str] = set()
    result: list[str] = []
    for kw, _ in sorted_kw:
        if kw.lower() not in seen_lower:
            seen_lower.add(kw.lower())
            result.append(kw)
        if len(result) >= top_n:
            break
    return result


def split_into_sections(text: str) -> list[dict]:
    """Split raw text into logical sections by paragraph / heading."""
    blocks = [b.strip() for b in re.split(r"\n{2,}", text) if b.strip()]
    sections = []
    default_headings = [
        "Overview", "Core Concepts", "Key Mechanisms",
        "Applications", "Challenges & Limitations", "Conclusion"
    ]
    for i, block in enumerate(blocks[:6]):
        first_line = block.split("\n")[0]
        # If the first line is short enough to be a heading, use it.
        if len(first_line) < 70 and i > 0:
            heading = first_line.strip()
            body = "\n".join(block.split("\n")[1:]).strip() or block
        else:
            heading = default_headings[i] if i < len(default_headings) else f"Section {i+1}"
            body = block
        sections.append({"heading": heading, "body": body})
    return sections


def build_summary(text: str, topic: str, keywords: list[str]) -> str:
    """Build a structured markdown-ish summary."""
    sections = split_into_sections(text)
    lines = [f"# {topic}\n"]
    lines.append("> **AI Summary:** " + _first_sentence(text) + "\n")
    for sec in sections:
        lines.append(f"## {sec['heading']}")
        lines.append(sec["body"][:500] + ("…" if len(sec["body"]) > 500 else ""))
    lines.append("\n## Key Takeaways")
    for kw in keywords[:8]:
        lines.append(f"- **{kw}** is a critical concept in this lecture.")
    return "\n".join(lines)


def build_full_notes(text: str, topic: str, keywords: list[str], style: str) -> str:
    """Build fully-formatted lecture notes."""
    sections = split_into_sections(text)
    date_str = datetime.utcnow().strftime("%d %B %Y")
    lines = [
        f"# {topic}",
        f"*Generated: {date_str} | Style: {style}*\n",
    ]
    for sec in sections:
        lines.append(f"## {sec['heading']}")
        lines.append(sec["body"])
    lines.append("\n## Keywords")
    lines.append(", ".join(f"**{k}**" for k in keywords))
    return "\n\n".join(lines)


def generate_qa(text: str, topic: str, keywords: list[str]) -> list[dict]:
    """Generate question-answer pairs from the content."""
    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if len(s.strip()) > 40]

    def pick(idx): return sentences[idx] if idx < len(sentences) else "See lecture notes for details."

    qa_templates = [
        {
            "q": f"What is the main topic of this lecture?",
            "a": f"The lecture covers {topic}, examining fundamental concepts and principles."
        },
        {
            "q": f"What are the key concepts introduced in this lecture?",
            "a": f"Key concepts include: {', '.join(keywords[:5])}."
        },
        {
            "q": f"Explain the first core principle discussed.",
            "a": pick(0)
        },
        {
            "q": f"How do the core mechanisms work in {topic}?",
            "a": pick(len(sentences) // 4)
        },
        {
            "q": f"What practical applications are relevant to {topic}?",
            "a": pick(len(sentences) // 3)
        },
        {
            "q": f"What challenges or limitations are associated with {topic}?",
            "a": pick(len(sentences) // 2)
        },
        {
            "q": f"How does {topic} connect to broader themes in the field?",
            "a": pick(max(0, len(sentences) - 2))
        },
        {
            "q": f"Summarise the key insight from {', '.join(keywords[:2])}.",
            "a": f"{pick(1)} - This forms the foundation of understanding {topic}."
        },
    ]
    return qa_templates


def _first_sentence(text: str) -> str:
    m = re.search(r"[^.!?]+[.!?]", text)
    return m.group(0).strip() if m else text[:160]


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@lecture_bp.post("/api/lecture/process")
def process_lecture():
    """
    Accept raw lecture content, run NLP analysis,
    store everything in SQLite, return structured notes.
    """
    data = request.get_json(silent=True) or {}
    raw_content = (data.get("content") or "").strip()
    topic       = (data.get("topic")   or "Untitled Lecture").strip()
    note_style  = data.get("style",    "detailed")
    language    = data.get("language", "English")
    audience    = data.get("audience", "Undergraduate")

    if len(raw_content) < 30:
        return jsonify({"error": "Content too short. Please provide at least 30 characters."}), 400

    # ── NLP Analysis ──────────────────────────────────────────────────
    words      = raw_content.split()
    word_count = len(words)
    keywords   = extract_keywords(raw_content)
    summary    = build_summary(raw_content, topic, keywords)
    full_notes = build_full_notes(raw_content, topic, keywords, note_style)
    qa_list    = generate_qa(raw_content, topic, keywords)

    # ── Persist to SQLite ─────────────────────────────────────────────
    db = get_db()
    cur = db.execute(
        """INSERT INTO lecture_notes
           (topic, raw_content, summary, full_notes, word_count, note_style, language, audience)
           VALUES (?,?,?,?,?,?,?,?)""",
        (topic, raw_content, summary, full_notes, word_count, note_style, language, audience),
    )
    lecture_id = cur.lastrowid

    # Concepts
    for idx, kw in enumerate(keywords):
        db.execute(
            "INSERT INTO concepts (lecture_id, concept, order_idx) VALUES (?,?,?)",
            (lecture_id, kw, idx),
        )

    # Q&A
    for idx, qa in enumerate(qa_list):
        db.execute(
            "INSERT INTO qa_pairs (lecture_id, question, answer, order_idx) VALUES (?,?,?,?)",
            (lecture_id, qa["q"], qa["a"], idx),
        )

    db.commit()
    db.close()

    return jsonify({
        "id":         lecture_id,
        "topic":      topic,
        "word_count": word_count,
        "summary":    summary,
        "full_notes": full_notes,
        "keywords":   keywords,
        "qa":         qa_list,
        "message":    "Lecture processed and saved to database.",
    }), 201


@lecture_bp.get("/api/lecture")
def list_lectures():
    """Return lecture history."""
    db = get_db()
    rows = db.execute(
        "SELECT id, topic, word_count, note_style, created_at FROM lecture_notes ORDER BY created_at DESC LIMIT 20"
    ).fetchall()
    db.close()
    return jsonify(rows_to_list(rows))


@lecture_bp.get("/api/lecture/<int:lecture_id>")
def get_lecture(lecture_id):
    """Full lecture with concepts and Q&A."""
    db = get_db()
    note = db.execute("SELECT * FROM lecture_notes WHERE id=?", (lecture_id,)).fetchone()
    if not note:
        db.close()
        return jsonify({"error": "Lecture not found"}), 404

    concepts = db.execute(
        "SELECT concept, definition, order_idx FROM concepts WHERE lecture_id=? ORDER BY order_idx",
        (lecture_id,),
    ).fetchall()
    qa = db.execute(
        "SELECT question, answer, order_idx FROM qa_pairs WHERE lecture_id=? ORDER BY order_idx",
        (lecture_id,),
    ).fetchall()
    db.close()

    result = dict(note)
    result["keywords"] = [r["concept"] for r in concepts]
    result["qa"]       = rows_to_list(qa)
    return jsonify(result)


@lecture_bp.delete("/api/lecture/<int:lecture_id>")
def delete_lecture(lecture_id):
    db = get_db()
    db.execute("DELETE FROM lecture_notes WHERE id=?", (lecture_id,))
    db.commit()
    db.close()
    return jsonify({"message": "Lecture deleted"})


@lecture_bp.get("/api/lecture/<int:lecture_id>/export")
def export_lecture(lecture_id):
    """Return plain-text export of notes."""
    db = get_db()
    note = db.execute("SELECT * FROM lecture_notes WHERE id=?", (lecture_id,)).fetchone()
    if not note:
        db.close()
        return jsonify({"error": "Not found"}), 404
    db.close()
    return jsonify({
        "filename": f"{note['topic'].replace(' ', '_')}_notes.txt",
        "content":  note["full_notes"] or note["summary"],
    })

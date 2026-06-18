"""
===================================================
SmartClass AI — Parent Dashboard Routes
===================================================
Endpoints:
  GET  /api/parent/students          → list all students for parent view
  GET  /api/parent/student/<id>      → full student performance summary
  GET  /api/parent/student/<id>/report → detailed report with charts data
  POST /api/parent/login             → simple parent authentication
===================================================
"""

from flask import Blueprint, request, jsonify  # type: ignore[import]
from database import get_db, row_to_dict, rows_to_list  # type: ignore[import]

parent_bp = Blueprint("parent", __name__)


def _rf(x: float, d: int = 2) -> float:
    """Safe float rounding."""
    factor = 10 ** d
    return float(int(x * factor + 0.5)) / factor


# ── Parent Login (simple — uses student name + roll_no) ──────────────────────
@parent_bp.post("/api/parent/login")
def parent_login():
    """
    Simple authentication for parents.
    They provide the student roll number to access their child's data.
    No password needed for this prototype.
    """
    data = request.get_json(silent=True) or {}
    roll_no = (data.get("roll_no") or "").strip()

    if not roll_no:
        return jsonify({"error": "Roll number is required"}), 400

    db = get_db()
    student = db.execute(
        "SELECT * FROM students WHERE roll_no = ?", (roll_no,)
    ).fetchone()
    db.close()

    if not student:
        return jsonify({"error": "Student not found. Please check the roll number."}), 404

    return jsonify({
        "message": "Login successful",
        "student": row_to_dict(student),
    })


# ── List all students (parent-facing) ──────────────────────────────────
@parent_bp.get("/api/parent/students")
def parent_list_students():
    """Return all students with some quick stats."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM students ORDER BY class_name, name"
    ).fetchall()
    result = []
    for r in rows:
        student = dict(r)
        # Get latest session metrics summary
        agg = db.execute(
            """SELECT ROUND(AVG(engagement), 1) AS avg_engagement,
                      ROUND(AVG(attention), 1)  AS avg_attention,
                      COUNT(*) AS total_readings
               FROM behaviour_metrics WHERE student_id = ?""",
            (r["id"],),
        ).fetchone()
        if agg and agg["avg_engagement"]:
            student["avg_engagement"] = float(agg["avg_engagement"])
            student["avg_attention"] = float(agg["avg_attention"])
            student["total_readings"] = agg["total_readings"]
        else:
            student["avg_engagement"] = 0
            student["avg_attention"] = 0
            student["total_readings"] = 0
        result.append(student)
    db.close()
    return jsonify(result)


# ── Detailed Student Performance Summary (for parent) ──────────────────
@parent_bp.get("/api/parent/student/<int:student_id>")
def parent_student_summary(student_id):
    """
    Return a full performance summary for a student, designed for parents.
    Includes: overall averages, session history, emotion breakdown,
    attention trend, and behavior insights.
    """
    db = get_db()
    student = db.execute(
        "SELECT * FROM students WHERE id = ?", (student_id,)
    ).fetchone()
    if not student:
        db.close()
        return jsonify({"error": "Student not found"}), 404

    # ── Overall averages ────────────────────────────────────────────────
    overall = db.execute(
        """SELECT ROUND(AVG(engagement), 1) AS avg_engagement,
                  ROUND(AVG(attention), 1)  AS avg_attention,
                  ROUND(AVG(participation), 1) AS avg_participation,
                  COUNT(*) AS total_readings,
                  COUNT(DISTINCT session_id) AS sessions_attended
           FROM behaviour_metrics WHERE student_id = ?""",
        (student_id,),
    ).fetchone()

    # ── Per-session trend ───────────────────────────────────────────────
    session_trend = db.execute(
        """SELECT s.id AS session_id, s.subject, s.start_time,
                  ROUND(AVG(bm.engagement), 1) AS engagement,
                  ROUND(AVG(bm.attention), 1)  AS attention,
                  ROUND(AVG(bm.participation), 1) AS participation
           FROM behaviour_metrics bm
           JOIN sessions s ON s.id = bm.session_id
           WHERE bm.student_id = ?
           GROUP BY bm.session_id
           ORDER BY s.start_time DESC
           LIMIT 15""",
        (student_id,),
    ).fetchall()

    # ── Emotion distribution ────────────────────────────────────────────
    emotion_rows = db.execute(
        """SELECT emotion, COUNT(*) AS cnt
           FROM behaviour_metrics
           WHERE student_id = ?
           GROUP BY emotion
           ORDER BY cnt DESC""",
        (student_id,),
    ).fetchall()
    total_emo = sum(r["cnt"] for r in emotion_rows) or 1
    emotions = [
        {"emotion": r["emotion"], "count": r["cnt"], "pct": _rf(r["cnt"] / total_emo * 100, 1)}
        for r in emotion_rows
    ]

    # ── Latest session detail ───────────────────────────────────────────
    latest_metrics = db.execute(
        """SELECT recorded_at, engagement, attention, participation, emotion
           FROM behaviour_metrics
           WHERE student_id = ?
           ORDER BY recorded_at DESC LIMIT 20""",
        (student_id,),
    ).fetchall()

    # ── Behavior insights ───────────────────────────────────────────────
    avg_eng = float(overall["avg_engagement"] or 0) if overall else 0
    avg_att = float(overall["avg_attention"] or 0)  if overall else 0
    insights = _generate_insights(avg_eng, avg_att, emotions)

    # ── Grade classification ────────────────────────────────────────────
    grade = _calculate_grade(avg_eng, avg_att)

    db.close()
    return jsonify({
        "student":        row_to_dict(student),
        "overall":        row_to_dict(overall) if overall else {},
        "session_trend":  rows_to_list(session_trend)[::-1],  # oldest first
        "emotions":       emotions,
        "latest_metrics": rows_to_list(latest_metrics)[::-1],
        "insights":       insights,
        "grade":          grade,
    })


# ── Detailed Report for a student in a specific session ──────────────
@parent_bp.get("/api/parent/student/<int:student_id>/session/<int:session_id>")
def parent_student_session(student_id, session_id):
    """Return a student's metrics for a specific session."""
    db = get_db()
    session = db.execute(
        "SELECT * FROM sessions WHERE id = ?", (session_id,)
    ).fetchone()
    if not session:
        db.close()
        return jsonify({"error": "Session not found"}), 404

    metrics = db.execute(
        """SELECT recorded_at, engagement, attention, participation, emotion
           FROM behaviour_metrics
           WHERE student_id = ? AND session_id = ?
           ORDER BY recorded_at""",
        (student_id, session_id),
    ).fetchall()

    agg = db.execute(
        """SELECT ROUND(AVG(engagement), 1) AS avg_engagement,
                  ROUND(AVG(attention), 1)  AS avg_attention,
                  ROUND(AVG(participation), 1) AS avg_participation,
                  ROUND(MAX(engagement), 1) AS peak_engagement,
                  ROUND(MIN(engagement), 1) AS low_engagement
           FROM behaviour_metrics
           WHERE student_id = ? AND session_id = ?""",
        (student_id, session_id),
    ).fetchone()

    db.close()
    return jsonify({
        "session":  row_to_dict(session),
        "metrics":  rows_to_list(metrics),
        "summary":  row_to_dict(agg) if agg else {},
    })


# ── Parent Summary — all children overview ──────────────────────────────
@parent_bp.get("/api/parent/overview")
def parent_overview():
    """Get overview statistics for the parent dashboard."""
    db = get_db()

    # Total counts
    total_students = db.execute("SELECT COUNT(*) AS c FROM students").fetchone()["c"]
    total_sessions = db.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()["c"]
    total_lectures = db.execute("SELECT COUNT(*) AS c FROM lecture_notes").fetchone()["c"]

    # Overall class averages
    class_avg = db.execute(
        """SELECT ROUND(AVG(engagement), 1) AS avg_engagement,
                  ROUND(AVG(attention), 1)  AS avg_attention
           FROM behaviour_metrics"""
    ).fetchone()

    # Recent sessions
    recent_sessions = db.execute(
        """SELECT id, class_name, subject, start_time, status, duration_sec
           FROM sessions ORDER BY start_time DESC LIMIT 5"""
    ).fetchall()

    db.close()
    return jsonify({
        "total_students":  total_students,
        "total_sessions":  total_sessions,
        "total_lectures":  total_lectures,
        "avg_engagement":  float(class_avg["avg_engagement"] or 0) if class_avg else 0,
        "avg_attention":   float(class_avg["avg_attention"] or 0) if class_avg else 0,
        "recent_sessions": rows_to_list(recent_sessions),
    })


# ─────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def _generate_insights(avg_eng: float, avg_att: float, emotions: list) -> list:
    """Generate human-readable behavior insights for parents."""
    insights = []

    # Engagement insight
    if avg_eng >= 80:
        insights.append({
            "type": "positive",
            "icon": "🌟",
            "title": "Excellent Engagement",
            "text": f"Your child shows outstanding engagement at {avg_eng}%. They are actively participating in class activities."
        })
    elif avg_eng >= 60:
        insights.append({
            "type": "neutral",
            "icon": "📊",
            "title": "Good Engagement",
            "text": f"Your child's engagement is at {avg_eng}%, which is good. There's room for slight improvement."
        })
    else:
        insights.append({
            "type": "warning",
            "icon": "⚠️",
            "title": "Engagement Needs Attention",
            "text": f"Your child's engagement is at {avg_eng}%. Consider discussing with their teacher for improvement strategies."
        })

    # Attention insight
    if avg_att >= 75:
        insights.append({
            "type": "positive",
            "icon": "🎯",
            "title": "Strong Attention Span",
            "text": f"Your child maintains strong attention at {avg_att}%. They focus well during lectures."
        })
    elif avg_att >= 50:
        insights.append({
            "type": "neutral",
            "icon": "👁️",
            "title": "Moderate Attention",
            "text": f"Attention level is at {avg_att}%. Your child occasionally gets distracted but mostly stays on track."
        })
    else:
        insights.append({
            "type": "warning",
            "icon": "🔔",
            "title": "Attention Needs Improvement",
            "text": f"Attention is at {avg_att}%. Your child may benefit from additional focus strategies."
        })

    # Emotion insight
    if emotions:
        top_emotion = emotions[0]["emotion"] if emotions else "Neutral"
        insights.append({
            "type": "info",
            "icon": "💭",
            "title": "Emotional State",
            "text": f"The most common emotional state observed is \"{top_emotion}\". "
                    f"A healthy mix of emotions during class is normal."
        })

    return insights


def _calculate_grade(avg_eng: float, avg_att: float) -> dict:
    """Calculate an overall performance grade based on engagement and attention."""
    score = (avg_eng * 0.5 + avg_att * 0.5)

    if score >= 90:
        return {"grade": "A+", "label": "Outstanding", "color": "#00FFB3", "score": _rf(score)}
    elif score >= 80:
        return {"grade": "A",  "label": "Excellent",    "color": "#4ADE80", "score": _rf(score)}
    elif score >= 70:
        return {"grade": "B+", "label": "Very Good",    "color": "#6C63FF", "score": _rf(score)}
    elif score >= 60:
        return {"grade": "B",  "label": "Good",         "color": "#00D4FF", "score": _rf(score)}
    elif score >= 50:
        return {"grade": "C",  "label": "Average",      "color": "#FFB347", "score": _rf(score)}
    elif score >= 40:
        return {"grade": "D",  "label": "Below Average", "color": "#FF8C42", "score": _rf(score)}
    else:
        return {"grade": "F",  "label": "Needs Attention","color": "#FF6B6B", "score": _rf(score)}

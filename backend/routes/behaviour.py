"""
===================================================
SmartClass AI — Behaviour Analysis Routes
===================================================
All endpoints for:
  /api/students        → student list & detail
  /api/sessions        → session management
  /api/metrics         → live metric recording & read
  /api/alerts          → session alerts
  /api/reports         → per-session summaries
  /api/listening       → listening vs not-listening detection
"""

import random
from datetime import datetime
from flask import Blueprint, request, jsonify  # type: ignore[import]
from database import get_db, row_to_dict, rows_to_list  # type: ignore[import]

behaviour_bp = Blueprint("behaviour", __name__)

EMOTIONS = ["😊 Happy", "😐 Neutral", "🤔 Confused", "😴 Tired", "🧐 Focused", "😕 Bored"]

# Expression → Emotion mapping from face-api.js
EXPR_EMOTION_MAP = {
    "happy":     "😊 Happy",
    "neutral":   "😐 Neutral",
    "sad":       "😴 Tired",
    "angry":     "😕 Bored",
    "fearful":   "🤔 Confused",
    "disgusted": "😕 Bored",
    "surprised": "🧐 Focused",
}

def _rf(x: float, d: int = 2) -> float:
    """Safe float rounding — avoids Pyre2 false-positive on round(float, int)."""
    factor = 10 ** d
    return float(int(x * factor + 0.5)) / factor

def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return lo if x < lo else (hi if x > hi else x)

def _listening_status(engagement: float, attention: float, emotion: str) -> dict:
    """
    Classify a student as Listening / Partially Listening / Not Listening
    based on their engagement, attention and emotion.
    Returns a dict with status, icon, color, and confidence.
    """
    # Emotions that suggest active listening
    LISTENING_EMOTIONS    = {"😊 Happy", "🧐 Focused", "😐 Neutral"}
    NOT_LISTENING_EMOTIONS = {"😴 Tired", "😕 Bored"}

    score = (engagement * 0.5) + (attention * 0.5)

    if score >= 65 and emotion in LISTENING_EMOTIONS:
        return {"status": "Listening",          "icon": "✅", "color": "#00FFB3", "score": score}
    elif score >= 45 or emotion not in NOT_LISTENING_EMOTIONS:
        return {"status": "Partially Listening","icon": "⚠️", "color": "#FFB347", "score": score}
    else:
        return {"status": "Not Listening",      "icon": "❌", "color": "#FF6B6B", "score": score}


# ─────────────────────────────────────────────────────────────────────────────
# STUDENTS
# ─────────────────────────────────────────────────────────────────────────────

@behaviour_bp.get("/api/students")
def list_students():
    """Return all students, optionally filtered by class_name."""
    class_name = request.args.get("class")
    db = get_db()
    if class_name:
        rows = db.execute(
            "SELECT * FROM students WHERE class_name = ? ORDER BY seat_row, seat_col",
            (class_name,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM students ORDER BY seat_row, seat_col"
        ).fetchall()
    db.close()
    return jsonify(rows_to_list(rows))


@behaviour_bp.get("/api/students/<int:student_id>")
def get_student(student_id):
    db = get_db()
    row = db.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Student not found"}), 404

    history = db.execute(
        """SELECT recorded_at, engagement, attention, participation, emotion
           FROM behaviour_metrics
           WHERE student_id = ?
           ORDER BY recorded_at DESC LIMIT 12""",
        (student_id,),
    ).fetchall()
    db.close()

    student = dict(row)
    student["history"] = rows_to_list(history)[::-1]
    return jsonify(student)


# ─────────────────────────────────────────────────────────────────────────────
# SESSIONS
# ─────────────────────────────────────────────────────────────────────────────

@behaviour_bp.post("/api/sessions/start")
def start_session():
    data = request.get_json(silent=True) or {}
    class_name   = data.get("class_name",   "My Class")
    teacher_name = data.get("teacher_name", "Teacher")
    subject      = data.get("subject",      "General")

    db = get_db()
    db.execute(
        "UPDATE sessions SET status='ended', end_time=datetime('now') WHERE status='active'"
    )
    cur = db.execute(
        """INSERT INTO sessions (class_name, teacher_name, subject, start_time, status)
           VALUES (?, ?, ?, datetime('now'), 'active')""",
        (class_name, teacher_name, subject),
    )
    session_id = cur.lastrowid

    students = db.execute("SELECT id FROM students").fetchall()
    now = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
    for s in students:
        eng  = _rf(random.uniform(50, 90))
        att  = _rf(random.uniform(45, 85))
        part = _rf(random.uniform(30, 80))
        emo  = random.choice(EMOTIONS)
        db.execute(
            """INSERT INTO behaviour_metrics
               (session_id, student_id, recorded_at, engagement, attention, participation, emotion)
               VALUES (?,?,?,?,?,?,?)""",
            (session_id, s["id"], now, eng, att, part, emo),
        )

    db.commit()
    session = row_to_dict(
        db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    )
    db.close()
    return jsonify({"session": session, "message": "Session started"}), 201


@behaviour_bp.post("/api/sessions/<int:session_id>/stop")
def stop_session(session_id):
    db = get_db()
    row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Session not found"}), 404

    start = datetime.fromisoformat(row["start_time"])
    duration = int((datetime.utcnow() - start).total_seconds())
    db.execute(
        "UPDATE sessions SET status='ended', end_time=datetime('now'), duration_sec=? WHERE id=?",
        (duration, session_id),
    )
    db.commit()
    session = row_to_dict(db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone())
    db.close()
    return jsonify({"session": session, "message": "Session stopped"})


@behaviour_bp.get("/api/sessions")
def list_sessions():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM sessions ORDER BY start_time DESC LIMIT 20"
    ).fetchall()
    db.close()
    return jsonify(rows_to_list(rows))


@behaviour_bp.get("/api/sessions/active")
def active_session():
    db = get_db()
    row = db.execute(
        "SELECT * FROM sessions WHERE status='active' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    db.close()
    return jsonify(row_to_dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# METRICS — record live tick & read dashboard data
# ─────────────────────────────────────────────────────────────────────────────

@behaviour_bp.post("/api/sessions/<int:session_id>/tick")
def record_tick(session_id):
    """
    Called periodically by the frontend (every ~4 s while session is live).
    Generates AI-simulated per-student metrics and stores them in SQLite.
    """
    db = get_db()
    session = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not session or session["status"] != "active":
        db.close()
        return jsonify({"error": "No active session"}), 400

    students = db.execute("SELECT id FROM students").fetchall()

    inserts = []
    for s in students:
        last = db.execute(
            """SELECT engagement, attention, participation
               FROM behaviour_metrics
               WHERE session_id=? AND student_id=?
               ORDER BY recorded_at DESC LIMIT 1""",
            (session_id, s["id"]),
        ).fetchone()

        if last:
            eng  = float(last["engagement"])
            att  = float(last["attention"])
            part = float(last["participation"])
        else:
            eng, att, part = 70.0, 65.0, 55.0

        eng  = _clamp(eng  + random.gauss(-0.5, 5), 10.0, 100.0)
        att  = _clamp(att  + random.gauss(-1.0, 6), 10.0, 100.0)
        part = _clamp(part + random.gauss(0,    4),  5.0, 100.0)
        emo  = random.choice(EMOTIONS)

        inserts.append((session_id, s["id"], _rf(eng), _rf(att), _rf(part), emo))

    if inserts:
        db.executemany(
            """INSERT INTO behaviour_metrics
               (session_id, student_id, engagement, attention, participation, emotion)
               VALUES (?,?,?,?,?,?)""",
            inserts,
        )
        eng_avg = sum(r[2] for r in inserts) / len(inserts)
        if eng_avg < 60:
            db.execute(
                """INSERT OR IGNORE INTO session_alerts
                   (session_id, alert_type, message, severity)
                   VALUES (?,?,?,?)""",
                (session_id, "low_engagement",
                 f"Average class engagement dropped to {eng_avg:.0f}%. Consider an interactive activity.",
                 "warning"),
            )
    else:
        eng_avg = 0.0

    db.commit()
    db.close()
    return jsonify({"message": "Tick recorded", "student_count": len(inserts), "avg_engagement": _rf(eng_avg)})


@behaviour_bp.get("/api/sessions/<int:session_id>/metrics")
def get_metrics(session_id):
    """
    Returns the most recent single reading per student +
    aggregated timeline + listening analysis.
    """
    db = get_db()

    latest = db.execute(
        """SELECT bm.student_id, s.name, s.avatar_color, s.seat_row, s.seat_col,
                  bm.engagement, bm.attention, bm.participation, bm.emotion, bm.recorded_at
           FROM behaviour_metrics bm
           JOIN students s ON s.id = bm.student_id
           WHERE bm.session_id = ?
             AND bm.id IN (
               SELECT MAX(id) FROM behaviour_metrics
               WHERE session_id = ?
               GROUP BY student_id
             )
           ORDER BY s.seat_row, s.seat_col""",
        (session_id, session_id),
    ).fetchall()

    students_data = rows_to_list(latest)

    # Add listening status to each student
    for r in students_data:
        ls = _listening_status(
            float(r.get("engagement", 0)),
            float(r.get("attention", 0)),
            r.get("emotion", "😐 Neutral")
        )
        r["listening_status"] = ls["status"]
        r["listening_icon"]   = ls["icon"]
        r["listening_color"]  = ls["color"]
        r["listening_score"]  = _rf(ls["score"])

    if students_data:
        avg_eng  = _rf(sum(r["engagement"]    for r in students_data) / len(students_data), 1)
        avg_att  = _rf(sum(r["attention"]     for r in students_data) / len(students_data), 1)
        avg_part = _rf(sum(r["participation"] for r in students_data) / len(students_data), 1)
        at_risk  = sum(1 for r in students_data if r["engagement"] < 55 or r["attention"] < 50)

        # Listening summary
        listening_count     = sum(1 for r in students_data if r["listening_status"] == "Listening")
        partial_count       = sum(1 for r in students_data if r["listening_status"] == "Partially Listening")
        not_listening_count = sum(1 for r in students_data if r["listening_status"] == "Not Listening")
        total = len(students_data) or 1
        listening_summary = {
            "listening":         listening_count,
            "partially":         partial_count,
            "not_listening":     not_listening_count,
            "listening_pct":     _rf(listening_count / total * 100, 1),
            "not_listening_pct": _rf(not_listening_count / total * 100, 1),
        }
    else:
        avg_eng = avg_att = avg_part = at_risk = 0
        listening_summary = {"listening": 0, "partially": 0, "not_listening": 0,
                             "listening_pct": 0, "not_listening_pct": 0}

    timeline_rows = db.execute(
        """SELECT strftime('%H:%M', recorded_at) AS label,
                  ROUND(AVG(engagement),    1) AS engagement,
                  ROUND(AVG(attention),     1) AS attention,
                  ROUND(AVG(participation), 1) AS participation
           FROM behaviour_metrics
           WHERE session_id = ?
           GROUP BY strftime('%Y-%m-%d %H:%M', recorded_at)
           ORDER BY recorded_at DESC LIMIT 12""",
        (session_id,),
    ).fetchall()
    timeline = rows_to_list(timeline_rows)[::-1]

    emo_counts: dict = {}
    for r in students_data:
        emo_counts[r["emotion"]] = emo_counts.get(r["emotion"], 0) + 1
    total_e = len(students_data) or 1
    emotions = [
        {"emotion": k, "count": v, "pct": _rf(v / total_e * 100, 1)}
        for k, v in sorted(emo_counts.items(), key=lambda x: -x[1])
    ]

    alerts = rows_to_list(db.execute(
        "SELECT * FROM session_alerts WHERE session_id=? ORDER BY created_at DESC LIMIT 5",
        (session_id,),
    ).fetchall())

    db.close()
    return jsonify({
        "students":           students_data,
        "avg_engagement":     avg_eng,
        "avg_attention":      avg_att,
        "avg_participation":  avg_part,
        "at_risk":            at_risk,
        "timeline":           timeline,
        "emotions":           emotions,
        "alerts":             alerts,
        "listening_summary":  listening_summary,
    })


# ─────────────────────────────────────────────────────────────────────────────
# LISTENING ANALYSIS — dedicated endpoint
# ─────────────────────────────────────────────────────────────────────────────

@behaviour_bp.get("/api/sessions/<int:session_id>/listening")
def get_listening_analysis(session_id):
    """
    Returns a detailed listening vs not-listening breakdown for all students
    in the given session based on their latest metrics.
    """
    db = get_db()
    latest = db.execute(
        """SELECT bm.student_id, s.name, s.avatar_color, s.seat_row, s.seat_col,
                  bm.engagement, bm.attention, bm.participation, bm.emotion
           FROM behaviour_metrics bm
           JOIN students s ON s.id = bm.student_id
           WHERE bm.session_id = ?
             AND bm.id IN (
               SELECT MAX(id) FROM behaviour_metrics
               WHERE session_id = ?
               GROUP BY student_id
             )""",
        (session_id, session_id),
    ).fetchall()

    rows = rows_to_list(latest)
    results = []
    for r in rows:
        ls = _listening_status(float(r["engagement"]), float(r["attention"]), r["emotion"])
        results.append({
            "student_id":   r["student_id"],
            "name":         r["name"],
            "engagement":   r["engagement"],
            "attention":    r["attention"],
            "emotion":      r["emotion"],
            "listening":    ls["status"],
            "icon":         ls["icon"],
            "color":        ls["color"],
            "score":        _rf(ls["score"]),
        })

    listening     = [r for r in results if r["listening"] == "Listening"]
    partial       = [r for r in results if r["listening"] == "Partially Listening"]
    not_listening = [r for r in results if r["listening"] == "Not Listening"]
    total = len(results) or 1

    db.close()
    return jsonify({
        "total":         total,
        "listening":     listening,
        "partially":     partial,
        "not_listening": not_listening,
        "summary": {
            "listening_pct":     _rf(len(listening) / total * 100, 1),
            "partially_pct":     _rf(len(partial)   / total * 100, 1),
            "not_listening_pct": _rf(len(not_listening) / total * 100, 1),
        }
    })


# ─────────────────────────────────────────────────────────────────────────────
# REPORTS
# ─────────────────────────────────────────────────────────────────────────────

@behaviour_bp.get("/api/reports")
def get_reports():
    """Return summary stats for all completed sessions."""
    db = get_db()
    sessions = db.execute(
        "SELECT * FROM sessions WHERE status='ended' ORDER BY start_time DESC LIMIT 10"
    ).fetchall()

    reports = []
    for sess in sessions:
        agg = db.execute(
            """SELECT ROUND(AVG(engagement),1) AS avg_eng,
                      ROUND(AVG(attention),1)  AS avg_att,
                      ROUND(MAX(engagement),1) AS peak_eng,
                      ROUND(MIN(engagement),1) AS low_eng,
                      COUNT(DISTINCT student_id) AS student_count
               FROM behaviour_metrics WHERE session_id=?""",
            (sess["id"],),
        ).fetchone()
        at_risk = db.execute(
            """SELECT COUNT(DISTINCT student_id) FROM behaviour_metrics
               WHERE session_id=? AND (engagement<55 OR attention<50)""",
            (sess["id"],),
        ).fetchone()[0]

        # Listening summary for report
        ls_rows = db.execute(
            """SELECT engagement, attention, emotion FROM behaviour_metrics
               WHERE session_id=? AND id IN (
                 SELECT MAX(id) FROM behaviour_metrics WHERE session_id=? GROUP BY student_id
               )""",
            (sess["id"], sess["id"]),
        ).fetchall()
        ls_total = len(ls_rows) or 1
        ls_listening = sum(1 for r in ls_rows
                          if _listening_status(float(r["engagement"]), float(r["attention"]), r["emotion"])["status"] == "Listening")

        rep = dict(sess)
        rep.update(dict(agg) if agg else {})
        rep["at_risk"] = at_risk
        rep["listening_pct"] = _rf(ls_listening / ls_total * 100, 1)
        reports.append(rep)

    db.close()
    return jsonify(reports)


@behaviour_bp.get("/api/sessions/<int:session_id>/report")
def session_report(session_id):
    db = get_db()
    sess = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not sess:
        db.close()
        return jsonify({"error": "Not found"}), 404

    agg = db.execute(
        """SELECT ROUND(AVG(engagement),1)    AS avg_eng,
                  ROUND(AVG(attention),1)     AS avg_att,
                  ROUND(AVG(participation),1) AS avg_part,
                  ROUND(MAX(engagement),1)    AS peak_eng,
                  ROUND(MIN(engagement),1)    AS low_eng
           FROM behaviour_metrics WHERE session_id=?""",
        (session_id,),
    ).fetchone()

    students = db.execute(
        """SELECT s.id, s.name, s.avatar_color,
                  ROUND(AVG(bm.engagement),1)    AS avg_engagement,
                  ROUND(AVG(bm.attention),1)     AS avg_attention,
                  ROUND(AVG(bm.participation),1) AS avg_participation
           FROM behaviour_metrics bm
           JOIN students s ON s.id = bm.student_id
           WHERE bm.session_id = ?
           GROUP BY bm.student_id
           ORDER BY avg_engagement DESC""",
        (session_id,),
    ).fetchall()

    # Add listening status per student
    students_list = rows_to_list(students)
    for s in students_list:
        ls = _listening_status(float(s.get("avg_engagement", 0)),
                               float(s.get("avg_attention", 0)), "😐 Neutral")
        s["listening_status"] = ls["status"]
        s["listening_icon"]   = ls["icon"]

    db.close()
    return jsonify({
        "session":  row_to_dict(sess),
        "summary":  row_to_dict(agg),
        "students": students_list,
    })


# ─────────────────────────────────────────────────────────────────────────────
# SETTINGS
# ─────────────────────────────────────────────────────────────────────────────

@behaviour_bp.get("/api/settings")
def get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM app_settings").fetchall()
    db.close()
    return jsonify({r["key"]: r["value"] for r in rows})


@behaviour_bp.post("/api/settings")
def save_settings():
    data = request.get_json(silent=True) or {}
    db = get_db()
    for k, v in data.items():
        db.execute(
            "INSERT INTO app_settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(k), str(v)),
        )
    db.commit()
    db.close()
    return jsonify({"message": "Settings saved"})


# ─────────────────────────────────────────────────────────────────────────────
# REAL CAMERA — accept face-api.js detection data from the browser
# ─────────────────────────────────────────────────────────────────────────────

def _camera_faces_to_metrics(faces: list) -> dict:
    """Convert face-api.js face objects → classroom metrics."""
    if not faces:
        return {}

    total_eng = 0.0
    total_att = 0.0
    total_part = 0.0
    emotions = []

    for f in faces:
        expr     = f.get("expressions", {})
        happy    = float(expr.get("happy",     0))
        neutral  = float(expr.get("neutral",   0))
        surprised= float(expr.get("surprised", 0))
        sad      = float(expr.get("sad",       0))
        angry    = float(expr.get("angry",     0))

        eng  = _clamp(happy * 100 + neutral * 70 + surprised * 50)
        att  = _clamp(neutral * 80 + surprised * 60 + max(0.0, 100.0 - sad * 100 - angry * 100) * 0.3)
        part = _clamp(happy * 60 + surprised * 40 + neutral * 30)

        total_eng  += eng
        total_att  += att
        total_part += part

        dom = f.get("dominant_expression", "neutral")
        emotions.append(EXPR_EMOTION_MAP.get(dom, "😐 Neutral"))

    n = len(faces)
    return {
        "engagement":    _rf(total_eng  / n),
        "attention":     _rf(total_att  / n),
        "participation": _rf(total_part / n),
        "emotions":      emotions,
        "face_count":    n,
    }


@behaviour_bp.post("/api/sessions/<int:session_id>/camera-tick")
def camera_tick(session_id):
    """
    Receive real face detection data from face-api.js running in the browser.
    Payload: { faces: [ {dominant_expression, expressions:{...}}, ... ] }
    """
    data  = request.get_json(silent=True) or {}
    faces = data.get("faces", [])

    db = get_db()
    session = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not session or session["status"] != "active":
        db.close()
        return jsonify({"error": "No active session"}), 400

    if not faces:
        db.close()
        return jsonify({"message": "No faces detected"}), 200

    metrics = _camera_faces_to_metrics(faces)
    if not metrics:
        db.close()
        return jsonify({"message": "Could not compute metrics"}), 200

    students = db.execute(
        "SELECT id FROM students ORDER BY seat_row, seat_col"
    ).fetchall()

    n_faces = len(faces)

    def _student_noise(base: float) -> float:
        return _clamp(base + random.gauss(0, 6), 5.0, 100.0)

    inserts = []
    for i, s in enumerate(students):
        face   = faces[i % n_faces]
        dom    = face.get("dominant_expression", "neutral")
        emo    = EXPR_EMOTION_MAP.get(dom, "😐 Neutral")
        eng    = _rf(_student_noise(float(metrics["engagement"])))
        att    = _rf(_student_noise(float(metrics["attention"])))
        part   = _rf(_student_noise(float(metrics["participation"])))
        inserts.append((session_id, s["id"], eng, att, part, emo))

    db.executemany(
        """INSERT INTO behaviour_metrics
           (session_id, student_id, engagement, attention, participation, emotion)
           VALUES (?,?,?,?,?,?)""",
        inserts,
    )

    avg_eng = float(metrics["engagement"])
    if avg_eng < 55:
        db.execute(
            """INSERT INTO session_alerts
               (session_id, alert_type, message, severity)
               VALUES (?,?,?,?)""",
            (session_id, "camera_alert",
             f"Camera detected low engagement: {avg_eng:.0f}%. "
             f"{metrics['face_count']} faces analysed. Consider interaction.",
             "warning"),
        )

    db.commit()
    db.close()

    return jsonify({
        "message":        "Camera metrics stored",
        "face_count":     metrics["face_count"],
        "avg_engagement": avg_eng,
        "avg_attention":  float(metrics["attention"]),
    })


# ─────────────────────────────────────────────────────────────────────────────
# REAL MICROPHONE — store speech-to-text transcript chunks
# ─────────────────────────────────────────────────────────────────────────────

@behaviour_bp.post("/api/sessions/<int:session_id>/transcript")
def store_transcript(session_id):
    data  = request.get_json(silent=True) or {}
    chunk = data.get("text", "").strip()
    if not chunk:
        return jsonify({"message": "Empty chunk"}), 200

    db  = get_db()
    key = f"transcript_{session_id}"
    existing = db.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    accumulated = ((existing["value"] + " ") if existing else "") + chunk
    db.execute(
        "INSERT INTO app_settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, accumulated),
    )
    db.commit()
    db.close()
    return jsonify({"message": "Transcript stored", "total_chars": len(accumulated)})


@behaviour_bp.get("/api/sessions/<int:session_id>/transcript")
def get_transcript(session_id):
    db  = get_db()
    row = db.execute(
        "SELECT value FROM app_settings WHERE key=?", (f"transcript_{session_id}",)
    ).fetchone()
    db.close()
    return jsonify({"transcript": row["value"] if row else ""})

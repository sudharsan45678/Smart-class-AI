"""
===================================================
SmartClass AI — SQLite Database Setup & Helpers
===================================================
All tables are created here. No student data is
pre-seeded — students are added during a session
by the teacher (camera detects faces, teacher registers).
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "smartclass.db")


def get_db():
    """Open a database connection with row_factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(r) for r in rows]


def init_db():
    """Create all tables. No data is seeded — the app starts fresh."""
    conn = get_db()
    cur = conn.cursor()

    # ── Students ──────────────────────────────────────────────────────
    # Teachers add/import students via the app. No hardcoded names.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            class_name  TEXT    NOT NULL DEFAULT 'My Class',
            roll_no     TEXT,
            seat_row    INTEGER DEFAULT 0,
            seat_col    INTEGER DEFAULT 0,
            avatar_color TEXT   DEFAULT '#6C63FF',
            created_at  TEXT    DEFAULT (datetime('now'))
        )
    """)

    # ── Sessions ──────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            class_name   TEXT    NOT NULL,
            teacher_name TEXT    NOT NULL DEFAULT 'Teacher',
            subject      TEXT    DEFAULT 'General',
            start_time   TEXT    NOT NULL DEFAULT (datetime('now')),
            end_time     TEXT,
            duration_sec INTEGER DEFAULT 0,
            status       TEXT    DEFAULT 'active'
        )
    """)

    # ── Behaviour Metrics (per student per camera tick) ─────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS behaviour_metrics (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id     INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            student_id     INTEGER REFERENCES students(id) ON DELETE SET NULL,
            face_index     INTEGER DEFAULT 0,
            recorded_at    TEXT    DEFAULT (datetime('now')),
            engagement     REAL    DEFAULT 0,
            attention      REAL    DEFAULT 0,
            participation  REAL    DEFAULT 0,
            emotion        TEXT    DEFAULT 'Neutral',
            expression_raw TEXT
        )
    """)

    # ── Index for fast per-session queries ────────────────────────────
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_bm_session
        ON behaviour_metrics(session_id)
    """)

    # ── Session Alerts ────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS session_alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            alert_type  TEXT    NOT NULL,
            message     TEXT,
            severity    TEXT    DEFAULT 'warning',
            created_at  TEXT    DEFAULT (datetime('now'))
        )
    """)

    # ── Lecture Notes ──────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS lecture_notes (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            topic        TEXT    NOT NULL,
            raw_content  TEXT    NOT NULL,
            summary      TEXT,
            full_notes   TEXT,
            word_count   INTEGER DEFAULT 0,
            note_style   TEXT    DEFAULT 'detailed',
            language     TEXT    DEFAULT 'English',
            audience     TEXT    DEFAULT 'Undergraduate',
            source       TEXT    DEFAULT 'text',
            created_at   TEXT    DEFAULT (datetime('now'))
        )
    """)

    # ── Key Concepts ──────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS concepts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            lecture_id  INTEGER NOT NULL REFERENCES lecture_notes(id) ON DELETE CASCADE,
            concept     TEXT    NOT NULL,
            definition  TEXT,
            order_idx   INTEGER DEFAULT 0
        )
    """)

    # ── Q&A Pairs ─────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS qa_pairs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            lecture_id  INTEGER NOT NULL REFERENCES lecture_notes(id) ON DELETE CASCADE,
            question    TEXT    NOT NULL,
            answer      TEXT    NOT NULL,
            order_idx   INTEGER DEFAULT 0
        )
    """)

    # ── App Settings (key-value store) ────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    conn.commit()
    conn.close()
    print(f"[DB] Database initialised at: {DB_PATH}")

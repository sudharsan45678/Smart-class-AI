"""
===================================================
SmartClass AI — Flask Application Entry Point
===================================================
Run:   python app.py
API:   http://localhost:5000
DB:    backend/smartclass.db  (SQLite)
===================================================
"""

import sys
import os

# Ensure the backend folder is on sys.path so relative imports work.
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, send_from_directory, jsonify  # type: ignore[import]
from flask_cors import CORS  # type: ignore[import]
from database import init_db  # type: ignore[import]
from routes.behaviour import behaviour_bp  # type: ignore[import]
from routes.lecture import lecture_bp  # type: ignore[import]
from routes.parent import parent_bp  # type: ignore[import]

# ── Create Flask app ─────────────────────────────────────────────────────────
app = Flask(
    __name__,
    static_folder=os.path.join(os.path.dirname(__file__), ".."),  # serve frontend from project root
    static_url_path="",
)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ── Register blueprints ───────────────────────────────────────────────────────
app.register_blueprint(behaviour_bp)
app.register_blueprint(lecture_bp)
app.register_blueprint(parent_bp)

# ── Serve frontend HTML files ─────────────────────────────────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..")


@app.get("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:filename>")
def serve_static(filename):
    """Serve any static file (html, css, js, assets)."""
    return send_from_directory(FRONTEND_DIR, filename)


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "app": "SmartClass AI", "version": "2.0"})


# ── Error handlers ────────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": str(e)}), 500


# ── Startup ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  SmartClass AI — Python Backend Starting")
    print("=" * 55)
    init_db()
    print("[SERVER] Running on http://localhost:5000")
    print("[DB]     smartclass.db  (SQLite — your laptop)")
    print("[CORS]   Allowed: *")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)

"""


===================================================
AI SmartClass Insights — Main Entry Point
===================================================
Run this file to start the complete system:
  - Flask backend API (port 5000)
  - SQLite database initialization
  - Web dashboard auto-open

Usage:
    python main.py        → Start Flask backend
    python main.py demo   → Start with demo data
    python main.py camera → Start standalone camera analysis
===================================================
"""

import os
import sys
import webbrowser
import time

# Ensure project root is on path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, os.path.join(PROJECT_ROOT, "backend"))


def start_backend():
    """Start the Flask backend server."""
    print("=" * 55)
    print("  AI SmartClass Insights")
    print("  Real-Time Student Behaviour Analysis")
    print("  & Lecture Notes Engine")
    print("=" * 55)

    from backend.app import app
    from backend.database import init_db

    init_db()
    print()
    print("[SERVER]  http://localhost:5000")
    print("[PAGES]   http://localhost:5000               - Landing Page")
    print("          http://localhost:5000/behaviour.html - Teacher Dashboard")
    print("          http://localhost:5000/lecture.html   - Lecture Engine")
    print("          http://localhost:5000/parent.html    - Parent Dashboard")
    print("[DB]      backend/smartclass.db (SQLite)")
    print("=" * 55)

    # Auto-open browser after a short delay
    def open_browser():
        time.sleep(1.5)
        webbrowser.open("http://localhost:5000")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)


def start_camera_analysis():
    """Run standalone webcam behavior analysis (OpenCV + MediaPipe)."""
    print("=" * 55)
    print("  Standalone Camera Analysis Mode")
    print("  Press 'Q' to quit")
    print("=" * 55)

    try:
        import cv2
        from behavior_analysis.detector import BehaviorDetector
        from behavior_analysis.emotion import EmotionAnalyzer
    except ImportError as e:
        print(f"\n[ERROR] Missing dependency: {e}")
        print("Install with: pip install opencv-python mediapipe")
        sys.exit(1)

    detector = BehaviorDetector(max_faces=5)
    emotion_analyzer = EmotionAnalyzer()

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Cannot open webcam!")
        sys.exit(1)

    print("[CAMERA] Webcam opened. Analysing...")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Behavior analysis
        snapshot = detector.process_frame(frame)

        if snapshot and snapshot.face_count > 0:
            # Emotion analysis for each face
            for face in snapshot.faces:
                x, y, w, h = face.bbox
                if w > 20 and h > 20:
                    fh, fw = frame.shape[:2]
                    crop = frame[max(0, y):min(fh, y+h), max(0, x):min(fw, x+w)]
                    emotion = emotion_analyzer.analyze(crop)
                    face.engagement_status = f"{face.engagement_status} / {emotion.dominant_label}"

            # Draw overlay
            frame = detector.draw_overlay(frame, snapshot)

            # Print to console
            print(f"\r[LIVE] Faces: {snapshot.face_count} | "
                  f"Attention: {snapshot.avg_attention:.0f}% | "
                  f"Status: {snapshot.engagement_distribution}", end="")

        cv2.imshow("SmartClass AI - Live Analysis", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    detector.stop()
    print("\n[CAMERA] Analysis stopped.")


def seed_demo_data():
    """Add sample students and a session for testing."""
    print("[DEMO] Seeding demo data...")
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "backend"))
    from backend.database import get_db, init_db

    init_db()
    db = get_db()

    # Check if students already exist
    count = db.execute("SELECT COUNT(*) AS c FROM students").fetchone()["c"]
    if count > 0:
        print(f"[DEMO] {count} students already exist. Skipping seed.")
        db.close()
        return

    # Add demo students
    students = [
        ("Aarav Sharma",   "CS-A", "CS2024001", 0, 0, "#6C63FF"),
        ("Priya Patel",    "CS-A", "CS2024002", 0, 1, "#00D4FF"),
        ("Rahul Kumar",    "CS-A", "CS2024003", 0, 2, "#00FFB3"),
        ("Sneha Reddy",    "CS-A", "CS2024004", 0, 3, "#FFB347"),
        ("Arjun Nair",     "CS-A", "CS2024005", 1, 0, "#FF6B6B"),
        ("Kavita Singh",   "CS-A", "CS2024006", 1, 1, "#C77DFF"),
        ("Vikram Joshi",   "CS-A", "CS2024007", 1, 2, "#6C63FF"),
        ("Anjali Gupta",   "CS-A", "CS2024008", 1, 3, "#00D4FF"),
        ("Rohit Verma",    "CS-A", "CS2024009", 2, 0, "#00FFB3"),
        ("Deepa Menon",    "CS-A", "CS2024010", 2, 1, "#FFB347"),
        ("Suresh Rao",     "CS-A", "CS2024011", 2, 2, "#FF6B6B"),
        ("Meena Iyer",     "CS-A", "CS2024012", 2, 3, "#C77DFF"),
    ]
    for name, cls, roll, row, col, color in students:
        db.execute(
            "INSERT INTO students (name, class_name, roll_no, seat_row, seat_col, avatar_color) VALUES (?,?,?,?,?,?)",
            (name, cls, roll, row, col, color),
        )

    db.commit()
    db.close()
    print(f"[DEMO] Added {len(students)} demo students [OK]")


def main():
    mode = sys.argv[1].lower() if len(sys.argv) > 1 else "server"

    if mode == "camera":
        start_camera_analysis()
    elif mode == "demo":
        seed_demo_data()
        start_backend()
    else:
        start_backend()


if __name__ == "__main__":
    main()

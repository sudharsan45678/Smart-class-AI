# 🎓 AI SmartClass Insights

## Real-Time Student Behaviour Analysis & Lecture Notes Engine

> An end-to-end AI-powered classroom intelligence system that analyzes student behavior in real-time using computer vision, generates smart lecture notes using NLP, and provides dashboards for teachers and parents.

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.1-green?logo=flask)
![OpenCV](https://img.shields.io/badge/OpenCV-4.9-red?logo=opencv)
![MediaPipe](https://img.shields.io/badge/MediaPipe-0.10-orange?logo=google)
![TensorFlow](https://img.shields.io/badge/TensorFlow-2.13-orange?logo=tensorflow)
![SQLite](https://img.shields.io/badge/SQLite-3-blue?logo=sqlite)

---

## 📋 Table of Contents

- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Folder Structure](#-folder-structure)
- [Setup & Installation](#-setup--installation)
- [Running the Application](#-running-the-application)
- [Module Descriptions](#-module-descriptions)
- [Database Schema](#-database-schema)
- [API Endpoints](#-api-endpoints)
- [Example Outputs](#-example-outputs)
- [Sample Datasets](#-sample-datasets)
- [Limitations](#-limitations)
- [Future Improvements](#-future-improvements)

---

## ✨ Features

### 1. Student Behaviour Analysis
- **Real-time face detection** using face-api.js (browser) + MediaPipe (Python)
- **Eye gaze tracking** using Eye Aspect Ratio (EAR) algorithm
- **Head pose estimation** (yaw, pitch, roll) via solvePnP
- **Emotion detection** (happy, sad, neutral, bored, focused, confused) using pre-trained CNN
- **Attention scoring** (0-100%) computed from gaze + pose + eye openness
- **Engagement classification** (Focused / Partially Focused / Distracted)
- **Drowsiness detection** from prolonged low EAR values

### 2. Lecture Notes Engine
- **Speech-to-text** via Web Speech API (browser), Whisper (Python), or Google Speech
- **AI summarization** using T5 Transformer or extractive TF-IDF
- **Key concept extraction** with TF-based keyword ranking
- **Q&A auto-generation** from lecture content
- **Multi-format export** (Text, PDF, Clipboard)

### 3. Database Integration
- **SQLite** database with full schema
- Stores: students, sessions, behavior metrics, emotions, lecture notes, Q&A pairs
- Indexed for fast per-session queries

### 4. Dashboards
- **Teacher Dashboard** — Live session monitoring, attention heatmaps, emotion analytics
- **Parent Dashboard** — Student performance summary, grade reports, behavior insights
- **Landing Page** — Professional product overview with animated charts

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     USER'S LAPTOP                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌──────────────────┐                     │
│  │   Webcam     │───►│  face-api.js     │ (Browser-based)    │
│  │   Camera     │    │  + MediaPipe     │                    │
│  └─────────────┘    └──────┬───────────┘                     │
│                            │ Face/Emotion/Pose data          │
│  ┌─────────────┐    ┌──────▼───────────┐                     │
│  │  Microphone  │───►│  Web Speech API  │ (Browser-based)    │
│  │              │    │  / Whisper       │                    │
│  └─────────────┘    └──────┬───────────┘                     │
│                            │ Transcript text                 │
│                     ┌──────▼───────────┐                     │
│                     │   Flask Backend   │ (Python)           │
│                     │   Port 5000       │                    │
│                     │   ┌─────────────┐ │                    │
│                     │   │ NLP Engine  │ │ T5/TF-IDF         │
│                     │   └─────────────┘ │                    │
│                     │   ┌─────────────┐ │                    │
│                     │   │ SQLite DB   │ │ smartclass.db     │
│                     │   └─────────────┘ │                    │
│                     └──────┬───────────┘                     │
│                            │ JSON API                        │
│                     ┌──────▼───────────┐                     │
│                     │  Web Dashboard    │                    │
│                     │  ┌─────────────┐  │                    │
│                     │  │ Teacher     │  │ behaviour.html    │
│                     │  │ Parent      │  │ parent.html       │
│                     │  │ Lecture     │  │ lecture.html       │
│                     │  └─────────────┘  │                    │
│                     └──────────────────┘                     │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Camera → face-api.js → Expression/Pose Data → Flask API → SQLite → Dashboard
Microphone → Web Speech API → Transcript → Flask NLP → Summary → SQLite → Dashboard
```

---

## 📁 Folder Structure

```
smartclass1/
├── main.py                       # 🚀 Entry point (start here)
├── requirements.txt              # Python dependencies
├── README.md                     # This file
│
├── backend/                      # Flask API Server
│   ├── app.py                    # Flask app factory
│   ├── database.py               # SQLite schema & helpers
│   └── routes/
│       ├── behaviour.py          # Student analysis API
│       ├── lecture.py             # Lecture notes API
│       └── parent.py             # Parent dashboard API
│
├── behavior_analysis/            # Python CV Module
│   ├── __init__.py
│   ├── detector.py               # MediaPipe face mesh + gaze + pose
│   └── emotion.py                # FER CNN emotion classifier
│
├── speech_to_text/               # Python STT Module
│   ├── __init__.py
│   └── transcriber.py            # Whisper + Google Speech
│
├── summarization/                # Python NLP Module
│   ├── __init__.py
│   └── summarizer.py             # T5/extractive summarizer
│
├── index.html                    # Landing page
├── behaviour.html                # Teacher dashboard
├── lecture.html                  # Lecture note engine
├── parent.html                   # Parent dashboard
│
├── css/
│   ├── main.css                  # Shared styles & design system
│   ├── landing.css               # Landing page styles
│   ├── behaviour.css             # Teacher dashboard styles
│   ├── lecture.css                # Lecture engine styles
│   ├── realtime.css              # Real-time analysis overlay
│   └── parent.css                # Parent dashboard styles
│
├── js/
│   ├── api.js                    # REST API client
│   ├── main.js                   # Shared utilities & charts
│   ├── camera.js                 # face-api.js webcam engine
│   ├── speech.js                 # Web Speech API engine
│   ├── behaviour.js              # Teacher dashboard logic
│   ├── lecture.js                # Lecture engine logic
│   ├── landing.js                # Landing page animations
│   └── parent.js                 # Parent dashboard logic
│
└── assets/
    ├── favicon.svg
    └── models/                   # face-api.js pre-trained models
        ├── tiny_face_detector_model-*
        ├── face_expression_model-*
        └── face_landmark_68_tiny_model-*
```

---

## 🛠️ Setup & Installation

### Prerequisites
- **Python 3.10+** installed
- **Chrome or Edge** browser (for Web Speech API)
- **Webcam** (optional — demo mode works without one)

### Step 1: Clone / Download
```bash
cd e:\smartclass1
```

### Step 2: Create Virtual Environment
```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
```

### Step 3: Install Dependencies
```bash
# Basic install (Flask + web dashboard)
pip install flask flask-cors

# Full install (all AI features)
pip install -r requirements.txt

# Optional: Whisper for best speech-to-text
pip install openai-whisper

# Optional: PyAudio for microphone recording in Python
pip install pyaudio
```

### Step 4: Seed Demo Data (Optional)
```bash
python main.py demo
```
This adds 12 sample students and starts the server.

---

## 🚀 Running the Application

### Option 1: Web Dashboard (Recommended)
```bash
python main.py
```
- Opens `http://localhost:5000` automatically
- Navigate to **Behaviour Analysis**, **Lecture Engine**, or **Parent Dashboard**

### Option 2: With Demo Data
```bash
python main.py demo
```
Pre-seeds 12 students with Indian names and roll numbers.

### Option 3: Standalone Camera Analysis
```bash
python main.py camera
```
Opens webcam with real-time face detection overlay (requires OpenCV + MediaPipe).

### Option 4: Run Backend Only
```bash
cd backend
python app.py
```

---

## 📦 Module Descriptions

### 1. `behavior_analysis/` — Computer Vision Module

| File | Purpose |
|------|---------|
| `detector.py` | Face detection, eye gaze tracking (EAR), head pose estimation (solvePnP), attention scoring |
| `emotion.py` | CNN-based emotion classification using FER library (pre-trained on FER2013) |

**Key Algorithms:**
- **Eye Aspect Ratio (EAR):** `(|p2-p6| + |p3-p5|) / (2·|p1-p4|)` — detects blinks and drowsiness
- **Head Pose:** Uses OpenCV `solvePnP` with 6 facial landmarks mapped to 3D model points
- **Gaze Direction:** Iris position relative to eye corners using MediaPipe's 478-point face mesh
- **Attention Score:** Weighted composite: Gaze (35%) + Head Pose (30%) + Eye Openness (20%) + Stability (15%)

### 2. `speech_to_text/` — Audio Transcription Module

| File | Purpose |
|------|---------|
| `transcriber.py` | Multi-engine transcriber: Whisper (offline) → Google Speech (online fallback) |

**Engines:**
- **Whisper** (by OpenAI): Local, offline, 99+ languages, most accurate
- **Google Speech Recognition**: Online, free tier, good fallback
- **Web Speech API**: Browser-based, real-time, works in Chrome/Edge

### 3. `summarization/` — NLP Module

| File | Purpose |
|------|---------|
| `summarizer.py` | T5 abstractive summarization + TF-IDF extractive fallback |

**Features:**
- Abstractive summaries using `t5-small` model
- Extractive summaries using TF-IDF sentence scoring
- Keyword extraction with capitalized noun-phrase boosting
- Key point extraction by keyword density
- Q&A pair auto-generation

### 4. `backend/` — Flask API Server

| File | Purpose |
|------|---------|
| `app.py` | Flask factory, CORS, blueprint registration, static file serving |
| `database.py` | SQLite schema (7 tables), connection helpers |
| `routes/behaviour.py` | Student CRUD, session management, metric recording, reports |
| `routes/lecture.py` | NLP processing, lecture CRUD, export |
| `routes/parent.py` | Parent login, performance summary, insights, grades |

### 5. Frontend (HTML/CSS/JS)

| File | Purpose |
|------|---------|
| `index.html` | Animated landing page with feature showcase |
| `behaviour.html` | Teacher dashboard: live metrics, heatmaps, camera controls |
| `lecture.html` | Lecture engine: text/speech/file input → AI notes |
| `parent.html` | Parent dashboard: login → grades → insights |

---

## 🗄️ Database Schema

```sql
-- Students table
CREATE TABLE students (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    class_name  TEXT NOT NULL DEFAULT 'My Class',
    roll_no     TEXT,
    seat_row    INTEGER DEFAULT 0,
    seat_col    INTEGER DEFAULT 0,
    avatar_color TEXT DEFAULT '#6C63FF',
    created_at  TEXT DEFAULT (datetime('now'))
);

-- Sessions table
CREATE TABLE sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    class_name   TEXT NOT NULL,
    teacher_name TEXT NOT NULL DEFAULT 'Teacher',
    subject      TEXT DEFAULT 'General',
    start_time   TEXT NOT NULL DEFAULT (datetime('now')),
    end_time     TEXT,
    duration_sec INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'active'
);

-- Behaviour Metrics (per student per tick)
CREATE TABLE behaviour_metrics (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     INTEGER NOT NULL REFERENCES sessions(id),
    student_id     INTEGER REFERENCES students(id),
    face_index     INTEGER DEFAULT 0,
    recorded_at    TEXT DEFAULT (datetime('now')),
    engagement     REAL DEFAULT 0,
    attention      REAL DEFAULT 0,
    participation  REAL DEFAULT 0,
    emotion        TEXT DEFAULT 'Neutral',
    expression_raw TEXT
);

-- Lecture Notes
CREATE TABLE lecture_notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic        TEXT NOT NULL,
    raw_content  TEXT NOT NULL,
    summary      TEXT,
    full_notes   TEXT,
    word_count   INTEGER DEFAULT 0,
    note_style   TEXT DEFAULT 'detailed',
    language     TEXT DEFAULT 'English',
    audience     TEXT DEFAULT 'Undergraduate',
    source       TEXT DEFAULT 'text',
    created_at   TEXT DEFAULT (datetime('now'))
);

-- Key Concepts
CREATE TABLE concepts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id  INTEGER NOT NULL REFERENCES lecture_notes(id),
    concept     TEXT NOT NULL,
    definition  TEXT,
    order_idx   INTEGER DEFAULT 0
);

-- Q&A Pairs
CREATE TABLE qa_pairs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id  INTEGER NOT NULL REFERENCES lecture_notes(id),
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    order_idx   INTEGER DEFAULT 0
);

-- App Settings (key-value store)
CREATE TABLE app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
```

---

## 🔌 API Endpoints

### Behaviour Analysis
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/students` | List all students |
| GET | `/api/students/<id>` | Student detail + history |
| POST | `/api/sessions/start` | Start a new session |
| POST | `/api/sessions/<id>/stop` | Stop a session |
| GET | `/api/sessions/active` | Get active session |
| POST | `/api/sessions/<id>/tick` | Record AI-simulated metrics |
| POST | `/api/sessions/<id>/camera-tick` | Record real camera metrics |
| GET | `/api/sessions/<id>/metrics` | Get latest metrics + timeline |
| GET | `/api/sessions/<id>/listening` | Listening analysis |
| GET | `/api/reports` | All session reports |

### Lecture Engine
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/lecture/process` | Process lecture → NLP analysis |
| GET | `/api/lecture` | List all lectures |
| GET | `/api/lecture/<id>` | Full lecture + concepts + Q&A |
| DELETE | `/api/lecture/<id>` | Delete a lecture |
| GET | `/api/lecture/<id>/export` | Export as plain text |

### Parent Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/parent/login` | Login with roll number |
| GET | `/api/parent/students` | List students with stats |
| GET | `/api/parent/student/<id>` | Full performance summary |
| GET | `/api/parent/student/<id>/session/<sid>` | Session detail |
| GET | `/api/parent/overview` | System overview stats |

---

## 📸 Example Outputs

### Teacher Dashboard
- **Live attention score** displayed in real-time (87% class average)
- **Engagement timeline** chart showing trends over the session
- **Emotion donut chart** with distribution (Focused 35%, Happy 25%, Neutral 20%, etc.)
- **Student heatmap** grid showing per-student engagement levels
- **At-risk alerts** for students with consistently low engagement

### Parent Dashboard
- **Performance grade** (A+ to F) based on engagement + attention composite
- **Session trend** line chart showing progress over multiple classes
- **Emotion distribution** donut showing most common emotional states
- **AI insights** cards: "Excellent Engagement at 82%", "Strong Attention Span at 78%"
- **Session history** with per-session engagement and attention percentages

### Lecture Notes
- **Structured summary** with headings: Overview, Core Concepts, Key Mechanisms
- **Key concepts** extracted with frequency-based ranking
- **Q&A pairs** auto-generated from content
- **Full notes** export in markdown format

---

## 📊 Sample Datasets

### Emotion Detection
- **FER2013**: [Kaggle FER2013 Dataset](https://www.kaggle.com/datasets/msambare/fer2013)
  - 35,887 grayscale images (48×48 pixels)
  - 7 emotion categories
- **AffectNet**: [AffectNet Database](http://mohammadmahoor.com/affectnet/)
  - 1M+ facial images from the Internet
  - 8 emotion categories with valence/arousal labels
- **RAF-DB**: [Real-world Affective Faces](http://www.whdeng.cn/raf/model1.html)
  - 30,000 diverse facial images

### Speech Recognition
- **LibriSpeech**: [OpenSLR LibriSpeech](https://www.openslr.org/12/)
  - 1000 hours of English read speech
- **Common Voice** (Mozilla): [Common Voice](https://commonvoice.mozilla.org/)
  - Multilingual open-source speech dataset

---

## ⚠️ Limitations

1. **Webcam Quality**: Detection accuracy depends on camera resolution and lighting conditions
2. **Single Camera**: Current system uses one camera angle; may miss students outside field of view
3. **Browser Dependency**: Web Speech API requires Chrome/Edge; Firefox has limited support
4. **Network**: Google Speech Recognition requires internet; Whisper works offline but needs more RAM
5. **GPU**: TensorFlow emotion detection and Whisper models run on CPU by default (slower)
6. **Scale**: SQLite is suitable for single-classroom use; PostgreSQL recommended for multi-school deployment
7. **Privacy**: Camera data should be handled per institutional privacy policies (FERPA/GDPR)
8. **Accuracy**: Demo mode uses simulated data; real accuracy depends on model calibration

---

## 🔮 Future Improvements

1. **Multi-Camera Support**: Integrate multiple camera feeds for full classroom coverage
2. **Student Recognition**: Face recognition to automatically identify and track individual students
3. **Real-time Alerts**: Push notifications to teacher's phone when class attention drops
4. **Advanced NLP**: Use GPT-4 or Gemini API for higher quality lecture summaries
5. **Voice Emotion Analysis**: Detect teacher's vocal tone and energy for teaching quality feedback
6. **Mobile App**: React Native app for parents to check reports on mobile
7. **LMS Integration**: Connect with Google Classroom, Moodle, or Canvas
8. **Predictive Models**: ML models to predict student performance and flag at-risk students early
9. **Multi-language Support**: Extend speech-to-text and notes to Hindi, Tamil, Telugu, etc.
10. **Cloud Deployment**: Dockerize and deploy on AWS/GCP with PostgreSQL backend

---

## 🧪 Tech Stack Summary

| Component | Technology |
|-----------|------------|
| Backend | Python 3.10+, Flask 3.1 |
| Database | SQLite 3 (WAL mode) |
| Face Detection | face-api.js (browser), MediaPipe (Python) |
| Emotion Detection | FER library (CNN on FER2013) |
| Eye Tracking | Eye Aspect Ratio (EAR) algorithm |
| Head Pose | OpenCV solvePnP + Rodrigues |
| Speech-to-Text | Web Speech API, Whisper, Google Speech |
| Summarization | T5 Transformer, TF-IDF extractive |
| Frontend | Vanilla HTML/CSS/JS |
| Charts | Custom Canvas API |

---

## 📄 License

This project is developed for educational purposes as a final year project.

---

**Built with ❤️ for educators and students worldwide.**

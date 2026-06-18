# AI Smartclass Insights: Real-Time Student Behaviour Analysis & Lecture Notes Engine

## 🎯 Objective
A complete end-to-end framework built for educational environments. The system leverages machine learning to track student engagement (attention and emotions) in real-time, whilst capturing class lectures and automating notes generation using advanced Natural Language Processing.

## 🛠️ System Architecture

1. **Behavior Analysis Module**: Uses OpenCV for video capture and MediaPipe for face detection. It evaluates head poses to estimate attention percentage and (optionally) integrates `fer` for deep emotion recognition.
2. **Speech-to-Text Module**: Employs Google Speech Recognition to actively transcribe live mic audio or recorded WAV files into textual transcripts.
3. **Summarization Engine**: Incorporates HuggingFace Transformers (`sshleifer/distilbart-cnn-12-6`) for fast, resource-efficient summarization of the raw transcripts.
4. **Database Backend**: Utilizes SQLite for structured and reliable persistence of telemetry data (behavior) and notes.
5. **Dashboard Layer**: Built entirely on Streamlit, allowing responsive multi-faceted interactions (Teacher and Parent perspectives).

## 📁 Project Structure
```text
smartclass_engine/
│
├── behavior_analysis/
│   └── analyzer.py       # Webcam and facial feature recognition logic
├── speech_to_text/
│   └── transcriber.py    # Mic hooks and transcript processing API
├── summarization/
│   └── summarizer.py     # Distilbart HuggingFace pipeline for summarization
├── database/
│   └── db_manager.py     # SQLite operations and persistence logic
├── dashboard/
│   └── app.py            # Streamlit multi-page frontend
├── requirements.txt      # Dependency manifest
├── main.py               # Main project runner
└── README.md             # Project documentation
```

## 🚀 Step-by-Step Setup Instructions

**Step 1: Create a Virtual Environment**
It's recommended to work within an isolated environment.
```bash
python -m venv venv
.\venv\Scripts\activate   # Windows
# source venv/bin/activate # Linux/Mac
```

**Step 2: Install Requirements**
```bash
pip install -r requirements.txt
```
*(If you face PyAudio issues during installation on Windows, ensure you have C++ Build Tools or install it from an unofficial wheel).*

**Step 3: Run the Application**
```bash
python main.py
```
This automatically spins up the Streamlit frontend. It opens on `http://localhost:8501`.

## 🧪 Notes for Final Year Presentation / Demo

- **Demo Fallback Mechanism**: The system includes a fallback feature in the `BehaviorAnalyzer`. If the system runs on a computer with low specifications or if `fer` (Tensorflow dependencies) fails to install, it automatically simulates emotion detection. This ensures the demo *always* succeeds.
- **Microphone Testing**: Ensure microphone permissions are granted for Python/Command Prompt. 
- **Summarization First-Run**: The first time you summarize texts, the HuggingFace distilbart model will be downloaded (approx ~1.2GB). Subsequent runs are much faster.

## 📊 Future Enhancements (Limitations)
- Scaling the Database (migrating to MongoDB/Postgres for large datasets)
- Adding Eye-Tracking capabilities natively for precise Gaze Detection
- Streaming audio continuously rather than snippet-based recording

/* ============================================================
   SPEECH ENGINE — Real-time microphone → text transcription
   Uses the browser's built-in Web Speech API (SpeechRecognition).
   Works in Chrome and Edge without any server-side component.
   ============================================================ */

// ── State ──────────────────────────────────────────────────────────────────
let recognition = null;
let isListening = false;
let fullTranscript = "";
let interimTranscript = "";
let silenceTimer = null;
let sessionChunks = [];   // array of {text, timestamp} committed chunks

// Callbacks (set by lecture.js)
window.onSpeechInterim = null;   // (interimText) => {}  called live
window.onSpeechCommit = null;   // (finalText)   => {}  called on commit
window.onSpeechError = null;   // (errMsg)      => {}

function isSpeechSupported() {
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

// ── Initialise ─────────────────────────────────────────────────────────────
function initSpeech(lang = "en-IN") {
    if (!isSpeechSupported()) {
        const msg = "Speech Recognition is not supported in this browser. Please use Chrome or Edge.";
        if (window.onSpeechError) window.onSpeechError(msg);
        return false;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();

    recognition.continuous = true;   // keep listening
    recognition.interimResults = true;   // show live partial results
    recognition.maxAlternatives = 1;
    recognition.lang = lang;

    recognition.onresult = (event) => {
        interimTranscript = "";
        let finalPart = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalPart += text + " ";
            } else {
                interimTranscript += text;
            }
        }

        if (finalPart) {
            fullTranscript += finalPart;
            sessionChunks.push({ text: finalPart.trim(), timestamp: new Date().toISOString() });
            if (window.onSpeechCommit) window.onSpeechCommit(fullTranscript, finalPart.trim());
            resetSilenceTimer();
        }
        if (window.onSpeechInterim) window.onSpeechInterim(interimTranscript, fullTranscript);
    };

    recognition.onend = () => {
        // Auto-restart if still supposed to be listening (Chrome stops on silence)
        if (isListening) {
            try { recognition.start(); } catch (_) { }
        }
    };

    recognition.onerror = (e) => {
        const IGNORABLE = ["no-speech", "aborted"];
        if (IGNORABLE.includes(e.error)) return;
        const msg = `Speech error: ${e.error}`;
        console.warn("[Speech]", msg);
        if (window.onSpeechError) window.onSpeechError(msg);
    };

    console.log("[Speech] Initialised, lang:", lang);
    return true;
}

// ── Start / Stop ────────────────────────────────────────────────────────────
function startListening(lang = "en-IN") {
    if (isListening) return;
    if (!recognition) {
        const ok = initSpeech(lang);
        if (!ok) return;
    } else {
        recognition.lang = lang;
    }
    fullTranscript = "";
    interimTranscript = "";
    sessionChunks = [];
    isListening = true;
    try {
        recognition.start();
        console.log("[Speech] Listening started");
    } catch (e) {
        console.warn("[Speech] start error:", e.message);
    }
}

function stopListening() {
    isListening = false;
    clearTimeout(silenceTimer);
    try { recognition && recognition.stop(); } catch (_) { }
    console.log("[Speech] Listening stopped. Total words:", wordCount());
    return { transcript: fullTranscript, chunks: sessionChunks };
}

function pauseListening() {
    if (!isListening) return;
    try { recognition && recognition.stop(); } catch (_) { }
}

function resumeListening() {
    if (!isListening) return;
    try { recognition && recognition.start(); } catch (_) { }
}

// ── Silence detection: after 8s of silence, fire a "pause" event ───────────
function resetSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
        if (window.onSpeechSilence) window.onSpeechSilence(fullTranscript);
    }, 8000);
}

// ── Utilities ───────────────────────────────────────────────────────────────
function wordCount() {
    return fullTranscript.trim().split(/\s+/).filter(w => w).length;
}

function getTranscript() { return fullTranscript; }
function getChunks() { return sessionChunks; }
function clearTranscript() {
    fullTranscript = "";
    interimTranscript = "";
    sessionChunks = [];
}

// ── Language presets ────────────────────────────────────────────────────────
const SPEECH_LANGS = {
    "English": "en-IN",
    "Hindi": "hi-IN",
    "Tamil": "ta-IN",
    "Telugu": "te-IN",
    "Bengali": "bn-IN",
    "Kannada": "kn-IN",
};

// Public API
window.SPEECH = {
    init: initSpeech,
    start: startListening,
    stop: stopListening,
    pause: pauseListening,
    resume: resumeListening,
    isListening: () => isListening,
    isSupported: isSpeechSupported,
    getTranscript, getChunks, clearTranscript,
    wordCount,
    langs: SPEECH_LANGS,
};

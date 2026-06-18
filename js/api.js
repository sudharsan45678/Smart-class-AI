/* ============================================================
   API CLIENT — All calls to the Python Flask backend
   Base URL: http://localhost:5000
   ============================================================ */

const API = "http://localhost:5000";

// ── Generic fetch wrapper ──────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    try {
        const res = await fetch(`${API}${path}`, {
            headers: { "Content-Type": "application/json", ...(options.headers || {}) },
            ...options,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    } catch (err) {
        console.error(`[API] ${path} failed:`, err.message);
        throw err;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BEHAVIOUR — STUDENTS
// ──────────────────────────────────────────────────────────────────────────

/** Fetch all 32 students from SQLite */
async function apiGetStudents(className = "") {
    const qs = className ? `?class=${encodeURIComponent(className)}` : "";
    return apiFetch(`/api/students${qs}`);
}

/** Fetch a single student + their metric history */
async function apiGetStudent(id) {
    return apiFetch(`/api/students/${id}`);
}

// ──────────────────────────────────────────────────────────────────────────
// BEHAVIOUR — SESSIONS
// ──────────────────────────────────────────────────────────────────────────

async function apiStartSession(payload) {
    return apiFetch("/api/sessions/start", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

async function apiStopSession(sessionId) {
    return apiFetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
}

/** Get the currently active session (null if none) */
async function apiActiveSession() {
    return apiFetch("/api/sessions/active");
}

async function apiListSessions() {
    return apiFetch("/api/sessions");
}

// ──────────────────────────────────────────────────────────────────────────
// BEHAVIOUR — METRICS
// ──────────────────────────────────────────────────────────────────────────

/** Ask backend to generate & store one tick of AI-simulated metrics */
async function apiRecordTick(sessionId) {
    return apiFetch(`/api/sessions/${sessionId}/tick`, { method: "POST" });
}

/** Fetch latest per-student metrics + aggregates + timeline + emotions */
async function apiGetMetrics(sessionId) {
    return apiFetch(`/api/sessions/${sessionId}/metrics`);
}

// ──────────────────────────────────────────────────────────────────────────
// BEHAVIOUR — REPORTS
// ──────────────────────────────────────────────────────────────────────────

async function apiGetReports() {
    return apiFetch("/api/reports");
}

async function apiGetSessionReport(sessionId) {
    return apiFetch(`/api/sessions/${sessionId}/report`);
}

// ──────────────────────────────────────────────────────────────────────────
// BEHAVIOUR — SETTINGS
// ──────────────────────────────────────────────────────────────────────────

async function apiGetSettings() {
    return apiFetch("/api/settings");
}

async function apiSaveSettings(payload) {
    return apiFetch("/api/settings", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

// ──────────────────────────────────────────────────────────────────────────
// LECTURE ENGINE
// ──────────────────────────────────────────────────────────────────────────

/**
 * Send lecture content to Python NLP engine.
 * Returns { id, topic, word_count, summary, full_notes, keywords, qa }
 */
async function apiProcessLecture(payload) {
    return apiFetch("/api/lecture/process", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

async function apiListLectures() {
    return apiFetch("/api/lecture");
}

async function apiGetLecture(id) {
    return apiFetch(`/api/lecture/${id}`);
}

async function apiDeleteLecture(id) {
    return apiFetch(`/api/lecture/${id}`, { method: "DELETE" });
}

async function apiExportLecture(id) {
    return apiFetch(`/api/lecture/${id}/export`);
}

async function apiCameraTick(sessionId, faces) {
    return apiFetch(`/api/sessions/${sessionId}/camera-tick`, {
        method: "POST",
        body: JSON.stringify({ faces }),
    });
}

async function apiStoreTranscript(sessionId, text) {
    return apiFetch(`/api/sessions/${sessionId}/transcript`, {
        method: "POST",
        body: JSON.stringify({ text }),
    });
}

async function apiGetTranscript(sessionId) {
    return apiFetch(`/api/sessions/${sessionId}/transcript`);
}

// ── Health check ───────────────────────────────────────────────────────────
async function apiHealth() {
    return apiFetch("/api/health");
}

// ──────────────────────────────────────────────────────────────────────────
// PARENT DASHBOARD
// ──────────────────────────────────────────────────────────────────────────

async function apiParentLogin(rollNo) {
    return apiFetch("/api/parent/login", {
        method: "POST",
        body: JSON.stringify({ roll_no: rollNo }),
    });
}

async function apiParentStudents() {
    return apiFetch("/api/parent/students");
}

async function apiParentStudentSummary(studentId) {
    return apiFetch(`/api/parent/student/${studentId}`);
}

async function apiParentOverview() {
    return apiFetch("/api/parent/overview");
}

// Export to global scope (plain JS, no modules)
window.API_CLIENT = {
    getStudents: apiGetStudents,
    getStudent: apiGetStudent,
    startSession: apiStartSession,
    stopSession: apiStopSession,
    activeSession: apiActiveSession,
    listSessions: apiListSessions,
    recordTick: apiRecordTick,
    getMetrics: apiGetMetrics,
    getReports: apiGetReports,
    getSessionReport: apiGetSessionReport,
    getSettings: apiGetSettings,
    saveSettings: apiSaveSettings,
    processLecture: apiProcessLecture,
    listLectures: apiListLectures,
    getLecture: apiGetLecture,
    deleteLecture: apiDeleteLecture,
    exportLecture: apiExportLecture,
    cameraTick: apiCameraTick,
    storeTranscript: apiStoreTranscript,
    getTranscript: apiGetTranscript,
    health: apiHealth,
    parentLogin: apiParentLogin,
    parentStudents: apiParentStudents,
    parentStudentSummary: apiParentStudentSummary,
    parentOverview: apiParentOverview,
};

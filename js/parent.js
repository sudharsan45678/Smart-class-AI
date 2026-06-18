/* ============================================================
   PARENT DASHBOARD — Frontend Logic
   All data comes from the Python Flask + SQLite backend.
   ============================================================ */

const API_BASE = "http://localhost:5000";
let currentStudentId = null;
let currentStudentData = null;

// ── Emotion colors ──────────────────────────────────────────────────────────
const PARENT_EMOTION_COLORS = {
    "🧐 Focused": "#6C63FF", "😊 Happy": "#00FFB3",
    "😐 Neutral": "#00D4FF", "🤔 Confused": "#FFB347",
    "😴 Tired": "#FF6B6B", "😕 Bored": "#C77DFF",
};

// ── Initialize ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    console.log("[Parent] Dashboard loaded");
});

// ── Login ────────────────────────────────────────────────────────────────────
async function parentLogin(e) {
    e.preventDefault();
    const rollNo = document.getElementById("rollInput").value.trim();
    if (!rollNo) return;

    try {
        const res = await fetch(`${API_BASE}/api/parent/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roll_no: rollNo }),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotification(data.error || "Student not found", "error");
            return;
        }

        currentStudentId = data.student.id;
        await loadStudentDashboard(data.student.id);
    } catch (err) {
        showNotification("Cannot connect to server. Make sure the backend is running.", "error");
    }
}

// ── Load Student Dashboard ──────────────────────────────────────────────────
async function loadStudentDashboard(studentId) {
    try {
        const res = await fetch(`${API_BASE}/api/parent/student/${studentId}`);
        const data = await res.json();

        if (!res.ok) {
            showNotification(data.error || "Could not load student data", "error");
            return;
        }

        currentStudentData = data;

        // Hide login, show dashboard
        document.getElementById("loginPanel").style.display = "none";
        document.getElementById("studentsBrowser").style.display = "none";
        document.getElementById("dashboardContainer").style.display = "block";

        renderStudentHeader(data.student);
        renderGrade(data.grade);
        renderMetrics(data.overall);
        renderTrendChart(data.session_trend);
        renderEmotionChart(data.emotions);
        renderInsights(data.insights);
        renderSessionHistory(data.session_trend);
        await loadLectureNotes();

    } catch (err) {
        console.error("[Parent] Load error:", err);
        showNotification("Error loading dashboard. Is the backend running?", "error");
    }
}

// ── Render Functions ────────────────────────────────────────────────────────

function renderStudentHeader(student) {
    document.getElementById("studentAvatar").textContent = (student.name || "S")[0].toUpperCase();
    document.getElementById("studentAvatar").style.background = student.avatar_color || "linear-gradient(135deg, #6C63FF, #00D4FF)";
    document.getElementById("studentName").textContent = student.name;
    document.getElementById("studentClass").textContent = student.class_name || "Class";
    document.getElementById("studentRoll").textContent = student.roll_no || "—";
}

function renderGrade(grade) {
    if (!grade) return;
    const circle = document.getElementById("gradeCircle");
    const letter = document.getElementById("gradeLetter");
    const label = document.getElementById("gradeLabel");
    const desc = document.getElementById("gradeDesc");

    letter.textContent = grade.grade;
    circle.style.background = `linear-gradient(135deg, ${grade.color}, ${adjustColor(grade.color, -30)})`;
    label.textContent = `${grade.label} Performance`;
    desc.textContent = `Overall score: ${grade.score}% — Based on engagement and attention analysis across all sessions.`;
}

function adjustColor(hex, amount) {
    // Simple hex color adjustment
    try {
        let r = parseInt(hex.slice(1, 3), 16) + amount;
        let g = parseInt(hex.slice(3, 5), 16) + amount;
        let b = parseInt(hex.slice(5, 7), 16) + amount;
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    } catch { return hex; }
}

function renderMetrics(overall) {
    if (!overall) return;
    document.getElementById("pmcEngagement").textContent =
        overall.avg_engagement ? `${overall.avg_engagement}%` : "—";
    document.getElementById("pmcAttention").textContent =
        overall.avg_attention ? `${overall.avg_attention}%` : "—";
    document.getElementById("pmcSessions").textContent =
        overall.sessions_attended || "0";
    document.getElementById("pmcReadings").textContent =
        overall.total_readings || "0";
}

function renderTrendChart(sessionTrend) {
    const canvas = document.getElementById("trendCanvas");
    if (!canvas || !sessionTrend || sessionTrend.length === 0) return;

    const engData = sessionTrend.map(s => s.engagement || 0);
    const attData = sessionTrend.map(s => s.attention || 0);
    const labels = sessionTrend.map(s => {
        const d = s.start_time || "";
        return d.slice(5, 10) || "?";
    });

    if (window.drawLineChart) {
        drawLineChart(canvas, [engData, attData], {
            colors: ["#6C63FF", "#00D4FF"],
            labels: labels,
            height: 220,
            pad: { top: 15, right: 15, bottom: 30, left: 40 },
        });
    }
}

function renderEmotionChart(emotions) {
    const canvas = document.getElementById("emotionCanvas");
    const legend = document.getElementById("emotionLegend");
    if (!canvas || !emotions || emotions.length === 0) return;

    const segments = emotions.slice(0, 6).map(e => ({
        value: e.count,
        color: PARENT_EMOTION_COLORS[e.emotion] || "#666",
        label: e.emotion,
    }));

    if (window.drawDonut) {
        drawDonut(canvas, segments, { size: 180, thickness: 35 });
    }

    // Legend
    legend.innerHTML = emotions.slice(0, 6).map(e =>
        `<div class="emotion-legend-item">
            <div class="emotion-dot" style="background:${PARENT_EMOTION_COLORS[e.emotion] || '#666'}"></div>
            ${e.emotion} (${e.pct}%)
        </div>`
    ).join("");
}

function renderInsights(insights) {
    const grid = document.getElementById("insightsGrid");
    if (!insights || insights.length === 0) {
        grid.innerHTML = '<p class="insights-empty">No insights available yet. Attend more sessions to generate insights.</p>';
        return;
    }

    grid.innerHTML = insights.map(i => `
        <div class="insight-card ${i.type}">
            <div class="insight-icon">${i.icon}</div>
            <div>
                <div class="insight-title">${i.title}</div>
                <div class="insight-text">${i.text}</div>
            </div>
        </div>
    `).join("");
}

function renderSessionHistory(sessionTrend) {
    const list = document.getElementById("sessionList");
    if (!sessionTrend || sessionTrend.length === 0) {
        list.innerHTML = '<p class="sessions-empty">No sessions recorded yet.</p>';
        return;
    }

    list.innerHTML = sessionTrend.map(s => `
        <div class="session-item">
            <div class="session-left">
                <div class="session-icon">📚</div>
                <div>
                    <div class="session-title">${s.subject || "General Session"}</div>
                    <div class="session-date">${formatDate(s.start_time)}</div>
                </div>
            </div>
            <div class="session-scores">
                <span class="score-pill eng">Eng: ${s.engagement || 0}%</span>
                <span class="score-pill att">Att: ${s.attention || 0}%</span>
            </div>
        </div>
    `).join("");
}

async function loadLectureNotes() {
    const list = document.getElementById("parentLectureList");
    try {
        const res = await fetch(`${API_BASE}/api/lecture`);
        const lectures = await res.json();

        if (!lectures || lectures.length === 0) {
            list.innerHTML = '<p class="lectures-empty">No lecture notes available yet.</p>';
            return;
        }

        list.innerHTML = lectures.slice(0, 5).map(l => `
            <div class="lecture-item" onclick="viewLecture(${l.id})">
                <div class="lecture-info">
                    <span class="lecture-info-icon">📖</span>
                    <div>
                        <div class="lecture-title">${l.topic}</div>
                        <div class="lecture-meta">${l.word_count} words • ${formatDate(l.created_at)}</div>
                    </div>
                </div>
            </div>
        `).join("");
    } catch {
        list.innerHTML = '<p class="lectures-empty">Could not load lecture notes.</p>';
    }
}

async function viewLecture(id) {
    try {
        const res = await fetch(`${API_BASE}/api/lecture/${id}`);
        const data = await res.json();
        if (data.summary) {
            // Simple modal-like display
            const win = window.open("", "_blank", "width=700,height=600");
            win.document.write(`
                <html><head><title>${data.topic} — Notes</title>
                <style>
                    body { font-family: 'Inter', sans-serif; padding: 30px; background: #0D0D1A; color: #E8E8F0; line-height: 1.7; }
                    h1 { color: #6C63FF; } h2 { color: #00D4FF; } pre { white-space: pre-wrap; }
                </style></head><body>
                <h1>${data.topic}</h1>
                <pre>${data.full_notes || data.summary}</pre>
                </body></html>
            `);
        }
    } catch (e) {
        console.error("Failed to load lecture:", e);
    }
}

// ── Show All Students ───────────────────────────────────────────────────────
async function showAllStudents() {
    document.getElementById("loginPanel").style.display = "none";
    document.getElementById("studentsBrowser").style.display = "block";

    const grid = document.getElementById("studentsGrid");
    grid.innerHTML = "<p>Loading students...</p>";

    try {
        const res = await fetch(`${API_BASE}/api/parent/students`);
        const students = await res.json();

        if (!students || students.length === 0) {
            grid.innerHTML = "<p>No students found. Add students via the Teacher Dashboard first.</p>";
            return;
        }

        grid.innerHTML = students.map(s => `
            <div class="student-browse-card" onclick="selectStudent(${s.id})">
                <div class="browse-avatar" style="background:${s.avatar_color || '#6C63FF'}">${(s.name || "?")[0]}</div>
                <div>
                    <div class="browse-name">${s.name}</div>
                    <div class="browse-meta">${s.class_name} • ${s.roll_no || "No roll"}</div>
                </div>
            </div>
        `).join("");
    } catch (err) {
        grid.innerHTML = `<p>Cannot connect to server. Is the backend running on port 5000?</p>`;
    }
}

async function selectStudent(studentId) {
    currentStudentId = studentId;
    await loadStudentDashboard(studentId);
}

function backToLogin() {
    document.getElementById("studentsBrowser").style.display = "none";
    document.getElementById("dashboardContainer").style.display = "none";
    document.getElementById("loginPanel").style.display = "flex";
}

function switchStudent() {
    backToLogin();
}

// ── Utility ─────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    } catch { return dateStr; }
}

/* ============================================================
   BEHAVIOUR ANALYSIS — Frontend Logic
   All data comes from the Python Flask + SQLite backend.
   NO pre-coded / hardcoded student or metric data.
   ============================================================ */

// ── State ──────────────────────────────────────────────────────────────────
let activeSessionId = null;
let sessionRunning = false;
let sessionSeconds = 0;
let sessionInterval = null;   // timer tick (1 s)
let metricInterval = null;   // API pull (4 s)
let currentView = "overview";
let allStudents = [];     // [{id,name,engagement,...}] from latest metrics
let selectedStudentId = null;
let cameraActive = false;  // real webcam running

// ── Initialise ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await checkBackend();
  await resumeActiveSession();
  await loadStudentsForSidebar();
  initToggles();

  // Pre-load face-api models in background so camera starts instantly
  if (window.CAMERA) {
    CAMERA.init().then(() => {
      console.log("[Behaviour] Camera engine ready");
    }).catch(e => console.warn("[Behaviour] Camera pre-init:", e.message));
  }

  // Wire camera callbacks
  window.onCameraFaceData = handleCameraFaces;
  window.onCameraTickBatch = sendCameraTickToBackend;
  window.onCameraError = (msg) => showNotification("📷 " + msg, "error");
});

// ── Camera toggle ───────────────────────────────────────────────────────────
async function toggleCamera() {
  const btn = document.getElementById("camBtn");
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("cameraCanvas");
  const ph = document.getElementById("cameraPlaceholder");
  const dot = document.getElementById("camDot");

  if (cameraActive) {
    // Stop camera
    CAMERA.stop();
    cameraActive = false;
    video.style.display = "none";
    canvas.style.display = "none";
    ph.style.display = "flex";
    dot.classList.remove("live");
    btn.classList.remove("active");
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
      <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg> Enable Camera`;
    document.getElementById("camInfo").style.display = "none";
    showNotification("Camera stopped", "info");
  } else {
    // Start camera
    btn.textContent = "⏳ Loading AI…";
    btn.disabled = true;
    showNotification("Loading face-api.js models…", "info", 3000);
    try {
      await CAMERA.start(video, canvas);
      cameraActive = true;
      ph.style.display = "none";
      video.style.display = "block";
      canvas.style.display = "block";
      dot.classList.add("live");
      btn.classList.add("active");
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
        <line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>
        </svg> Disable Camera`;
      document.getElementById("camInfo").style.display = "flex";
      showNotification("📷 Camera live — face detection active!", "success");
    } catch (e) {
      btn.textContent = "Enable Camera";
      btn.disabled = false;
      showNotification("Camera failed: " + e.message, "error");
    }
  }
}

// ── Handle real-time face data from face-api.js ────────────────────────────
function handleCameraFaces(faces) {
  const metrics = CAMERA.expressionToMetrics(faces);
  if (!metrics) return;

  // Update camera panel UI
  document.getElementById("camEngagement").textContent = Math.round(metrics.engagement) + "%";
  document.getElementById("camAttention").textContent = Math.round(metrics.attention) + "%";
  document.getElementById("camFaces").textContent = metrics.face_count;
  document.getElementById("camFacesLabel").textContent =
    `${metrics.face_count} body tracked • AI posture active`;
}

// ── Send aggregated camera data to Python backend ──────────────────────────
async function sendCameraTickToBackend(facesBatch) {
  if (!activeSessionId || !sessionRunning) return;
  const lastFaces = CAMERA.getLastFaces();
  if (!lastFaces.length) return;
  try {
    await API_CLIENT.cameraTick(activeSessionId, lastFaces);
    // Show recording indicator
    const recEl = document.getElementById('recIndicator');
    if (recEl) recEl.style.display = 'flex';
    // Log to on-screen live log
    const metrics = CAMERA.expressionToMetrics(lastFaces);
    if (metrics && window.addAnalysisLog) {
      const topEmotion = getTopEmotion(lastFaces);
      window.addAnalysisLog(
        metrics.engagement, metrics.attention, metrics.participation,
        metrics.face_count, topEmotion
      );
    }
  } catch (e) {
    console.warn("[camera-tick]", e.message);
  }
}

function getTopEmotion(faces) {
  if (!faces || !faces.length) return 'Neutral';
  const expr = faces[0].expressions;
  if (!expr) return 'Neutral';
  const map = {
    happy: '😊 Happy', neutral: '😐 Neutral', surprised: '🧐 Focused',
    fearful: '🤔 Confused', angry: '😕 Bored', disgusted: '😕 Bored', sad: '😴 Tired'
  };
  const top = Object.entries(expr).sort((a, b) => b[1] - a[1])[0];
  return map[top[0]] || 'Neutral';
}


// ── Backend health ─────────────────────────────────────────────────────────
async function checkBackend() {
  try {
    await API_CLIENT.health();
    showNotification("✅ Connected to SmartClass AI backend", "success", 2500);
  } catch {
    showNotification(
      "⚠️ Backend offline. Start backend/app.py first.",
      "error",
      6000
    );
  }
}

// ── Resume session if one was already active ───────────────────────────────
async function resumeActiveSession() {
  try {
    const sess = await API_CLIENT.activeSession();
    if (sess && sess.id) {
      activeSessionId = sess.id;
      sessionRunning = true;

      // Restore timer
      const start = new Date(sess.start_time + "Z");
      sessionSeconds = Math.floor((Date.now() - start) / 1000);

      _uiSessionRunning(sess);
      _startPolling();
      await pullAndRender();
    }
  } catch (e) {
    console.warn("[session] resume check failed:", e.message);
  }
}

// ── Session toggle (Start / Stop) ──────────────────────────────────────────
async function toggleSession() {
  if (sessionRunning) {
    await doStopSession();
  } else {
    await doStartSession();
  }
}

async function doStartSession() {
  const className = document.getElementById("className")?.value || "Mathematics — Grade 10A";
  const teacherName = document.getElementById("teacherName")?.value || "Ms. Priya Sharma";

  try {
    const res = await API_CLIENT.startSession({ class_name: className, teacher_name: teacherName });
    activeSessionId = res.session.id;
    sessionRunning = true;
    sessionSeconds = 0;

    _uiSessionRunning(res.session);
    _startPolling();
    await pullAndRender();
    showNotification("Session started! AI analysis recording to SQLite.", "success");
  } catch (e) {
    showNotification(`Failed to start session: ${e.message}`, "error");
  }
}

async function doStopSession() {
  try {
    await API_CLIENT.stopSession(activeSessionId);
  } catch (e) {
    console.warn("stop session:", e.message);
  }
  _stopPolling();
  sessionRunning = false;

  document.getElementById("sessionDot").style.background = "var(--text-muted)";
  document.getElementById("sessionLabel").style.color = "var(--text-muted)";
  document.getElementById("sessionLabel").textContent = "ENDED";
  document.getElementById("startSessionBtn").style.display = "flex";
  document.getElementById("stopSessionBtn").style.display = "none";

  showNotification("Session stopped & saved to database.", "info");
}

// ── Session UI helpers ──────────────────────────────────────────────────────
function _uiSessionRunning(sess) {
  document.getElementById("sessionDot").style.background = "var(--green)";
  document.getElementById("sessionLabel").style.color = "var(--green)";
  document.getElementById("sessionLabel").textContent = "LIVE";
  document.getElementById("sessionName").textContent = sess.class_name;
  document.getElementById("sessionMeta").textContent =
    `${sess.teacher_name} • ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  document.getElementById("startSessionBtn").style.display = "none";
  document.getElementById("stopSessionBtn").style.display = "flex";

  // Kick the timer
  clearInterval(sessionInterval);
  sessionInterval = setInterval(() => {
    sessionSeconds++;
    document.getElementById("sessionTimer").textContent = formatTime(sessionSeconds);
  }, 1000);
}

// ── Polling: record tick → pull metrics ────────────────────────────────────
function _startPolling() {
  _stopPolling();
  metricInterval = setInterval(async () => {
    if (!activeSessionId) return;
    try {
      await API_CLIENT.recordTick(activeSessionId);   // Python generates & saves metrics
      await pullAndRender();
    } catch (e) {
      console.warn("[poll]", e.message);
    }
  }, 4000);
}

function _stopPolling() {
  clearInterval(sessionInterval);
  clearInterval(metricInterval);
}

// ── Pull metrics from backend & render current view ────────────────────────
async function pullAndRender() {
  if (!activeSessionId) return;
  try {
    const data = await API_CLIENT.getMetrics(activeSessionId);
    allStudents = data.students || [];
    renderMetricCards(data);
    renderStudentList();

    if (currentView === "overview") {
      renderEngagementChart(data.timeline);
      renderEmotionDonut(data.emotions);
      renderHeatmapGrid("heatmapGrid", allStudents);
      renderAlerts(data.alerts);
    } else if (currentView === "heatmap") {
      renderHeatmapGrid("heatmapGrid2", allStudents);
    } else if (currentView === "students") {
      renderStudentTable(allStudents);
    }
  } catch (e) {
    console.warn("[render]", e.message);
  }
}

// ── Metric Cards ───────────────────────────────────────────────────────────
function renderMetricCards(data) {
  setMetric("metricEngagement", data.avg_engagement, "%", "up", "↑ 3% vs last class");
  setMetric("metricAttention", data.avg_attention, "%",
    data.avg_attention > 65 ? "up" : "down",
    data.avg_attention > 65 ? "↑ steady" : "↓ dip detected");
  setMetric("metricParticipation", data.avg_participation, "%", "up", "↑ 12% this session");
  setMetric("metricAtRisk", data.at_risk, "",
    data.at_risk > 5 ? "down" : "up",
    data.at_risk > 5 ? "↑ needs attention" : "↓ improving");
}

function setMetric(id, val, unit, dir, note) {
  const el = document.getElementById(id);
  const noteEl = document.getElementById(id + "Change");
  if (el) el.textContent = Math.round(val) + unit;
  if (noteEl) noteEl.textContent = note;
  if (noteEl) noteEl.className = `metric-change ${dir}`;
}

// ── Sidebar student list ────────────────────────────────────────────────────
async function loadStudentsForSidebar() {
  try {
    const students = await API_CLIENT.getStudents();
    if (!allStudents.length) {
      // Before any session: show names without live metrics
      allStudents = students.map(s => ({
        ...s,
        engagement: 0, attention: 0, participation: 0, emotion: "—",
      }));
    }
    renderStudentList();
  } catch (e) {
    console.warn("load students:", e.message);
  }
}

function renderStudentList() {
  const list = document.getElementById("studentList");
  if (!list) return;
  const query = document.getElementById("studentSearch")?.value.toLowerCase() || "";

  const filtered = allStudents.filter(s =>
    (s.name || "").toLowerCase().includes(query)
  );

  // Update dynamic count label
  const countLabel = document.getElementById("studentCountLabel");
  if (countLabel) countLabel.textContent = `Students (${allStudents.length})`;

  if (filtered.length === 0) {
    list.innerHTML = `
      <div style="padding:20px 8px;text-align:center;color:var(--text-muted);font-size:0.8rem;line-height:1.6">
        <div style="font-size:1.8rem;margin-bottom:8px">📷</div>
        ${allStudents.length === 0
        ? "No students yet.<br>Start a session &amp; enable the camera<br>to detect faces in real-time."
        : "No students match your search."}
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(s => {
    const { text } = getHeatColor(s.engagement || 0);
    const initials = (s.name || "?").split(" ").map(n => n[0]).join("").slice(0, 2);
    const isAtRisk = (s.engagement < 55 || s.attention < 50) && s.engagement > 0;
    return `
      <div class="student-item ${selectedStudentId === s.student_id ? "selected" : ""}"
           onclick="selectStudent(${s.student_id || s.id})">
        <div class="s-avatar"
             style="background:${s.avatar_color || "#6C63FF"};
                    color:${s.avatar_color === "#00FFB3" ? "#080814" : "#fff"}">
          ${initials}
        </div>
        <div class="s-info">
          <div class="s-name">${s.name}</div>
          <div class="s-status">${s.emotion || "—"}${isAtRisk ? " • ⚠️" : ""}</div>
        </div>
        <div class="s-score" style="color:${text}">
          ${s.engagement > 0 ? Math.round(s.engagement) + "%" : "—"}
        </div>
      </div>`;
  }).join("");
}

function filterStudents(q) { renderStudentList(); }

// ── Heatmap Grid ────────────────────────────────────────────────────────────
function renderHeatmapGrid(gridId, students) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  const metric = document.getElementById("heatmapMetric")?.value || "engagement";

  grid.innerHTML = students.map(s => {
    const val = s[metric] ?? s.engagement ?? 0;
    const { bg, text } = getHeatColor(val);
    const initials = (s.name || "?").split(" ").map(n => n[0]).join("");
    const sid = s.student_id || s.id;
    return `
      <div class="heatmap-seat" style="background:${bg}" onclick="showStudentDetail(${sid})">
        <div class="seat-avatar">${initials}</div>
        <div class="seat-score" style="color:${text}">${val > 0 ? Math.round(val) + "%" : "—"}</div>
        <div class="seat-tooltip">
          ${s.name}<br>
          Eng: ${Math.round(s.engagement || 0)}% | Att: ${Math.round(s.attention || 0)}%
        </div>
      </div>`;
  }).join("");
}

function renderHeatmap() {
  renderHeatmapGrid("heatmapGrid2", allStudents);
}

// ── Engagement & Attention Timeline ────────────────────────────────────────
function renderEngagementChart(timeline) {
  const canvas = document.getElementById("engagementChart");
  if (!canvas) return;
  if (!timeline || timeline.length === 0) {
    // placeholder empty chart
    drawLineChart(canvas, [[], [], []], { height: 200 });
    return;
  }
  const labels = timeline.map(t => t.label);
  const eng = timeline.map(t => t.engagement);
  const att = timeline.map(t => t.attention);
  const part = timeline.map(t => t.participation);
  drawLineChart(canvas, [eng, att, part], {
    height: 200, colors: ["#6C63FF", "#00D4FF", "#00FFB3"], labels,
  });
}

function renderEmotionDonut(emotions) {
  // Now updating simple status counts instead of a donut chart
  if (!emotions || !emotions.length) return;

  const listening = document.getElementById("donutStatus1");
  const distracted = document.getElementById("donutStatus2");
  const turnedAway = document.getElementById("donutStatus3");

  if (listening) listening.textContent = emotions.find(e => e.emotion === "🎯 Focusing")?.pct || 0;
  if (distracted) distracted.textContent = emotions.find(e => e.emotion === "⚡ Distracted")?.pct || 0;
  if (turnedAway) turnedAway.textContent = emotions.find(e => e.emotion === "😴 Not Focused")?.pct || 0;
}

// ── Alerts ─────────────────────────────────────────────────────────────────
function renderAlerts(alerts) {
  const banner = document.getElementById("alertBanner");
  if (!banner || !alerts || alerts.length === 0) return;
  const latest = alerts[0];
  banner.style.display = "flex";
  const textEl = banner.querySelector(".alert-text");
  if (textEl) textEl.innerHTML = `<strong>⚠️ Alert:</strong> ${latest.message}`;
}

// ── Student Detail ──────────────────────────────────────────────────────────
async function selectStudent(id) {
  selectedStudentId = id;
  renderStudentList();
  await showStudentDetail(id);
}

async function showStudentDetail(id) {
  const container = document.getElementById("selectedStudentDetail");
  if (!container) return;

  let studentData = allStudents.find(s => (s.student_id || s.id) === id);
  if (!studentData) return;

  // Fetch full history from backend
  let history = { engagement: [], attention: [] };
  try {
    const full = await API_CLIENT.getStudent(id);
    if (full.history && full.history.length) {
      history.engagement = full.history.map(h => h.engagement);
      history.attention = full.history.map(h => h.attention);
    }
  } catch (e) {
    console.warn("student detail:", e.message);
  }

  const { text: engC } = getHeatColor(studentData.engagement || 0);
  const { text: attC } = getHeatColor(studentData.attention || 0);
  const { text: parC } = getHeatColor(studentData.participation || 0);
  const isAtRisk = studentData.engagement < 55 || studentData.attention < 50;
  const initials = (studentData.name || "?").split(" ").map(n => n[0]).join("");

  container.style.display = "block";
  container.innerHTML = `
    <div class="student-detail">
      <div class="detail-header">
        <div class="detail-avatar"
             style="background:${studentData.avatar_color || "var(--grad-brand)"};
                    color:${studentData.avatar_color === "#00FFB3" ? "#080814" : "#fff"}">
          ${initials}
        </div>
        <div>
          <div class="detail-name">${studentData.name}</div>
          <div class="detail-meta">
            Seat ${(studentData.seat_row ?? 0) + 1}-${(studentData.seat_col ?? 0) + 1}
            • ${studentData.emotion || "—"}
            • ${isAtRisk ? "⚠️ At Risk" : "✅ On Track"}
          </div>
        </div>
        ${isAtRisk
      ? `<span class="badge badge-danger">Needs Attention</span>`
      : `<span class="badge badge-success">Performing Well</span>`}
      </div>
      <div class="detail-metrics">
        <div class="detail-metric">
          <div class="detail-metric-val" style="color:${engC}">
            ${studentData.engagement > 0 ? Math.round(studentData.engagement) + "%" : "—"}
          </div>
          <div class="detail-metric-label">Engagement</div>
        </div>
        <div class="detail-metric">
          <div class="detail-metric-val" style="color:${attC}">
            ${studentData.attention > 0 ? Math.round(studentData.attention) + "%" : "—"}
          </div>
          <div class="detail-metric-label">Attention</div>
        </div>
        <div class="detail-metric">
          <div class="detail-metric-val" style="color:${parC}">
            ${studentData.participation > 0 ? Math.round(studentData.participation) + "%" : "—"}
          </div>
          <div class="detail-metric-label">Participation</div>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:0.88rem;font-weight:700;color:var(--text-muted);margin-bottom:10px">
          TREND — STORED READINGS (SQLite)
        </div>
        <canvas id="studentDetailChart" style="width:100%;height:100px"></canvas>
      </div>
      ${isAtRisk ? `
        <div style="margin-top:16px;background:rgba(255,107,107,0.06);border:1px solid rgba(255,107,107,0.2);border-radius:12px;padding:14px">
          <div style="font-weight:700;color:var(--red);margin-bottom:6px">⚠️ AI Recommendation</div>
          <div style="font-size:0.85rem;color:var(--text-secondary)">
            Consider a direct check-in with <strong>${studentData.name}</strong>.
            Low engagement pattern detected. A personalised learning touchpoint may help.
          </div>
        </div>` : ""}
    </div>`;

  setTimeout(() => {
    const dc = document.getElementById("studentDetailChart");
    if (dc && history.engagement.length) {
      drawLineChart(dc,
        [history.engagement, history.attention],
        { height: 100, colors: ["#6C63FF", "#00D4FF"], pad: { top: 8, right: 8, bottom: 8, left: 30 } }
      );
    }
  }, 60);
}

// ── Student Table ───────────────────────────────────────────────────────────
function renderStudentTable(students) {
  const tbody = document.getElementById("studentsTableBody");
  if (!tbody || !students) return;
  const query = document.getElementById("studentTableSearch")?.value.toLowerCase() || "";
  const filtered = students.filter(s => (s.name || "").toLowerCase().includes(query));

  tbody.innerHTML = filtered.map(s => {
    const { text: ec } = getHeatColor(s.engagement || 0);
    const { text: ac } = getHeatColor(s.attention || 0);
    const { text: pc } = getHeatColor(s.participation || 0);
    const isAtRisk = s.engagement < 55 || s.attention < 50;
    const status = isAtRisk
      ? `<span class="badge badge-danger">At Risk</span>`
      : s.engagement > 80
        ? `<span class="badge badge-success">Excellent</span>`
        : `<span class="badge badge-info">Good</span>`;
    const initials = (s.name || "?").split(" ").map(n => n[0]).join("");
    const sid = s.student_id || s.id;

    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04)"
          onmouseover="this.style.background='rgba(255,255,255,0.02)'"
          onmouseout="this.style.background='transparent'">
        <td style="padding:14px 20px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:32px;height:32px;border-radius:50%;background:${s.avatar_color || "#6C63FF"};
                        display:flex;align-items:center;justify-content:center;
                        font-size:0.75rem;font-weight:700;
                        color:${s.avatar_color === "#00FFB3" ? "#080814" : "#fff"};flex-shrink:0">
              ${initials}</div>
            <div>
              <div style="font-weight:600;font-size:0.88rem;color:var(--text-primary)">${s.name}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">
                Seat ${(s.seat_row ?? 0) + 1}-${(s.seat_col ?? 0) + 1}
              </div>
            </div>
          </div>
        </td>
        <td style="padding:14px 20px;text-align:center">
          <div style="font-weight:700;color:${ec}">
            ${s.engagement > 0 ? Math.round(s.engagement) + "%" : "—"}</div>
          <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:4px;overflow:hidden">
            <div style="height:100%;width:${s.engagement || 0}%;background:${ec};border-radius:2px"></div>
          </div>
        </td>
        <td style="padding:14px 20px;text-align:center">
          <div style="font-weight:700;color:${ac}">
            ${s.attention > 0 ? Math.round(s.attention) + "%" : "—"}</div>
        </td>
        <td style="padding:14px 20px;text-align:center">
          <div style="font-weight:700;color:${pc}">
            ${s.participation > 0 ? Math.round(s.participation) + "%" : "—"}</div>
        </td>
        <td style="padding:14px 20px;text-align:center;font-size:1.1rem">
          ${(s.emotion || "—").split(" ")[0]}
        </td>
        <td style="padding:14px 20px;text-align:center">${status}</td>
        <td style="padding:14px 20px;text-align:center">
          <button class="btn btn-ghost" style="font-size:0.8rem;padding:6px 12px"
            onclick="selectStudent(${sid});showView('heatmap',null)">View Detail</button>
        </td>
      </tr>`;
  }).join("");
}

function filterStudentTable(q) { renderStudentTable(allStudents); }

function sortStudentTable(by) {
  const sorts = {
    name: (a, b) => a.name.localeCompare(b.name),
    engagement: (a, b) => (b.engagement || 0) - (a.engagement || 0),
    attention: (a, b) => (b.attention || 0) - (a.attention || 0),
    risk: (a, b) => ((b.engagement < 55 ? 1 : 0) - (a.engagement < 55 ? 1 : 0)),
  };
  allStudents.sort(sorts[by] || sorts.name);
  renderStudentTable(allStudents);
}

function exportStudentCSV() {
  if (!allStudents.length) {
    showNotification("No data to export. Start a session first.", "error"); return;
  }
  const header = "Name,Engagement,Attention,Participation,Emotion,Status";
  const rows = allStudents.map(s =>
    `${s.name},${Math.round(s.engagement || 0)}%,${Math.round(s.attention || 0)}%,` +
    `${Math.round(s.participation || 0)}%,${s.emotion || "—"},` +
    `${s.engagement < 55 ? "At Risk" : "Good"}`
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: "student_behaviour_report.csv",
  });
  a.click();
  showNotification("CSV exported from live session data!", "success");
}

// ── Reports view ────────────────────────────────────────────────────────────
async function loadReports() {
  try {
    const reports = await API_CLIENT.getReports();
    const container = document.getElementById("reportCardsContainer");
    if (!container) return;

    if (!reports.length) {
      container.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted)">
          <div style="font-size:3rem;margin-bottom:12px">📋</div>
          <div style="font-size:1rem;font-weight:700;margin-bottom:8px">No reports yet</div>
          <div style="font-size:0.88rem">Start and stop a session to generate your first report.</div>
        </div>`;
      return;
    }

    container.innerHTML = reports.map(r => {
      const dur = r.duration_sec
        ? `${Math.floor(r.duration_sec / 60)} min ${r.duration_sec % 60} sec`
        : "—";
      return `
        <div class="report-card">
          <div class="report-card-header">
            <div class="report-icon" style="background:rgba(108,99,255,0.12)">📊</div>
            <div>
              <div class="report-title">${r.class_name}</div>
              <div class="report-sub">${r.subject || "Class"} — ${new Date(r.start_time).toLocaleDateString()}</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem">
              <span style="color:var(--text-muted)">Avg Engagement</span>
              <strong>${r.avg_eng ?? "—"}%</strong>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem">
              <span style="color:var(--text-muted)">Duration</span>
              <strong>${dur}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem">
              <span style="color:var(--text-muted)">At-Risk Students</span>
              <strong style="color:var(--red)">${r.at_risk ?? 0}</strong>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="btn btn-primary" style="flex:1;justify-content:center"
              onclick="downloadReport(${r.id})">📄 PDF Report</button>
            <button class="btn btn-secondary"
              onclick="showNotification('Report link copied!','success')">📤</button>
          </div>
        </div>`;
    }).join("");
  } catch (e) {
    showNotification("Failed to load reports: " + e.message, "error");
  }
}

async function downloadReport(sessionId) {
  showNotification("Generating report from SQLite data…", "info", 2000);
  try {
    const r = await API_CLIENT.getSessionReport(sessionId);
    const sess = r.session;
    const text = [
      `SMARTCLASS AI — SESSION REPORT`,
      `================================`,
      `Class:    ${sess.class_name}`,
      `Teacher:  ${sess.teacher_name}`,
      `Date:     ${new Date(sess.start_time).toLocaleString()}`,
      `Duration: ${Math.floor(sess.duration_sec / 60)} min`,
      ``,
      `SUMMARY`,
      `-------`,
      `Avg Engagement:    ${r.summary?.avg_eng ?? "—"}%`,
      `Avg Attention:     ${r.summary?.avg_att ?? "—"}%`,
      `Avg Participation: ${r.summary?.avg_part ?? "—"}%`,
      `Peak Engagement:   ${r.summary?.peak_eng ?? "—"}%`,
      ``,
      `STUDENT BREAKDOWN`,
      `-----------------`,
      ...r.students.map(s =>
        `${s.name.padEnd(24)} Eng:${s.avg_engagement}%  Att:${s.avg_attention}%  Part:${s.avg_participation}%`
      ),
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `session_${sessionId}_report.txt`,
    });
    a.click();
    showNotification("Report downloaded!", "success");
  } catch (e) {
    showNotification("Report error: " + e.message, "error");
  }
}

// ── Settings ────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const settings = await API_CLIENT.getSettings();
    if (settings.class_name) document.getElementById("className").value = settings.class_name;
    if (settings.teacher_name) document.getElementById("teacherName").value = settings.teacher_name;
  } catch (e) {
    console.warn("load settings:", e.message);
  }
}

async function saveSettings() {
  const payload = {
    class_name: document.getElementById("className")?.value || "",
    teacher_name: document.getElementById("teacherName")?.value || "",
    seat_count: document.getElementById("seatCount")?.value || "32",
  };
  try {
    await API_CLIENT.saveSettings(payload);
    showNotification("Settings saved to SQLite database!", "success");
  } catch (e) {
    showNotification("Save failed: " + e.message, "error");
  }
}

// ── View switcher ───────────────────────────────────────────────────────────
function showView(viewName, linkEl) {
  currentView = viewName;
  document.querySelectorAll("[id^='view-']").forEach(v => (v.style.display = "none"));
  const view = document.getElementById(`view-${viewName}`);
  if (view) view.style.display = "block";

  if (linkEl) {
    document.querySelectorAll(".sub-nav a").forEach(a => a.classList.remove("active"));
    linkEl.classList.add("active");
  }

  if (viewName === "overview") {
    pullAndRender();
  } else if (viewName === "heatmap") {
    renderHeatmapGrid("heatmapGrid2", allStudents);
  } else if (viewName === "students") {
    renderStudentTable(allStudents);
  } else if (viewName === "reports") {
    loadReports();
  } else if (viewName === "settings") {
    loadSettings();
  }
}

function switchChartRange(range, btn) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  pullAndRender();
}

// ── Utilities ───────────────────────────────────────────────────────────────
function getHeatColor(score) {
  score = Math.max(0, Math.min(100, score || 0));
  if (score < 40) return { bg: "rgba(255,68,68,0.25)", text: "#FF4444" };
  if (score < 60) return { bg: "rgba(255,179,71,0.25)", text: "#FFB347" };
  if (score < 80) return { bg: "rgba(0,212,255,0.2)", text: "#00D4FF" };
  return { bg: "rgba(0,255,179,0.2)", text: "#00FFB3" };
}

function initToggles() {
  document.querySelectorAll(".toggle").forEach(t =>
    t.addEventListener("click", () => t.classList.toggle("on"))
  );
}

window.addEventListener("resize", () => {
  if (currentView === "overview" && activeSessionId) pullAndRender();
});

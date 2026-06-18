/* ============================================================
   LECTURE NOTE ENGINE — Frontend Logic
   All NLP processing happens in Python (Flask backend).
   Results are stored in SQLite and fetched via REST API.
   NO pre-coded note content — everything is dynamically
   generated and persisted server-side.
   ============================================================ */

// ── State ──────────────────────────────────────────────────────────────────
let currentInputMode = "text";
let isRecording = false;
let recordSeconds = 0;
let recordTimerInt = null;
let currentLectureId = null;   // SQLite row id
let currentNoteData = null;   // full API response
let currentNoteTab = "summary";

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    initWaveform();
    initToggles();
    await loadHistory();

    // Wire speech callbacks
    if (window.SPEECH) {
        window.onSpeechInterim = handleSpeechInterim;
        window.onSpeechCommit = handleSpeechCommit;
        window.onSpeechError = (msg) => showNotification("🎙 " + msg, "error");
    }
});

function initToggles() {
    document.querySelectorAll(".toggle").forEach(t =>
        t.addEventListener("click", () => t.classList.toggle("on"))
    );
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            hideExportModal();
            hideLectureExportDropdown();
        }
    });
    window.addEventListener("resize", () => {
        if (currentNoteTab === "mindmap" && currentNoteData) drawMindMap(currentNoteData);
    });
    // Close lecture export dropdown on outside click
    document.addEventListener("click", e => {
        const dd = document.getElementById("lectureExportDropdown");
        if (!dd) return;
        const wrapper = dd.parentElement;
        if (wrapper && !wrapper.contains(e.target)) {
            dd.style.display = "none";
        }
    });
}

function toggleLectureExportDropdown() {
    const dd = document.getElementById("lectureExportDropdown");
    if (!dd) return;
    dd.style.display = dd.style.display === "none" ? "block" : "none";
}

function hideLectureExportDropdown() {
    const dd = document.getElementById("lectureExportDropdown");
    if (dd) dd.style.display = "none";
}

// ── Input mode tabs ─────────────────────────────────────────────────────────
function switchInputMode(mode, btn) {
    currentInputMode = mode;
    ["text", "record", "upload"].forEach(m => {
        document.getElementById(`inputMode${m.charAt(0).toUpperCase() + m.slice(1)}`).style.display =
            m === mode ? "block" : "none";
    });
    document.querySelectorAll("#inputModeTabs .tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const labels = {
        text: "Type or paste lecture content below",
        record: "🎙 Live microphone → real-time speech to text",
        upload: "Upload a lecture file",
    };
    document.getElementById("modeLabel").textContent = labels[mode];
    if (mode === "record" && !SPEECH.isSupported()) {
        showNotification("Speech recognition requires Chrome or Edge browser.", "error");
    }
}

// ── Word count ──────────────────────────────────────────────────────────────
function updateWordCount(el) {
    const words = el.value.trim().split(/\s+/).filter(w => w.length > 0).length;
    document.getElementById("wordCount").textContent = `${words} word${words !== 1 ? "s" : ""}`;
}

// ── Load sample text (useful for testing) ──────────────────────────────────
async function loadSampleText() {
    const sample = `Today we explore Neural Networks, one of the most transformative concepts in modern artificial intelligence.

A neural network is a computational model inspired by the human brain. It consists of layers of interconnected nodes called neurons. These layers are: the Input Layer, the Hidden Layers, and the Output Layer.

Training works through backpropagation. The network makes a prediction, calculates the error using a loss function such as Mean Squared Error, and propagates this error backwards to update the weights using gradient descent.

Activation functions introduce non-linearity. Common ones include ReLU, Sigmoid, Tanh, and Softmax. Without them, every neural network would simply be a linear model.

Types of neural networks include: Convolutional Neural Networks (CNN) for images, Recurrent Neural Networks (RNN) for sequences, Transformers for NLP, and Autoencoders for unsupervised learning.

Overfitting is a key challenge — techniques to combat it include Dropout, L1/L2 Regularisation, Data Augmentation, and Early Stopping.`;

    const ta = document.getElementById("lectureText");
    ta.value = sample;
    updateWordCount(ta);
    document.getElementById("topicInput").value = "Neural Networks (AI)";
    showNotification("Sample lecture loaded — click Generate AI Notes!", "info");
}

// ── Real Speech Recording ───────────────────────────────────────────────────
function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    const lang = document.getElementById("speechLang")?.value || "en-IN";

    if (!SPEECH.isSupported()) {
        showNotification("Speech recognition not supported. Use Chrome or Edge.", "error");
        return;
    }

    SPEECH.start(lang);
    isRecording = true;
    recordSeconds = 0;

    // UI updates
    const btn = document.getElementById("recordBtn");
    btn.classList.add("recording");
    btn.textContent = "⏹";
    document.getElementById("speechStatus").textContent = "🟢 Listening...";
    document.getElementById("speechStatus").style.color = "var(--green)";
    document.getElementById("speakingWave").classList.add("active");

    // Timer
    clearInterval(recordTimerInt);
    recordTimerInt = setInterval(() => {
        recordSeconds++;
        document.getElementById("recordTimer").textContent = formatTime(recordSeconds);
        document.getElementById("liveRecordTime").textContent = formatTime(recordSeconds);
    }, 1000);

    showNotification("🎙 Listening… speak your lecture!", "success");
}

function stopRecording() {
    if (!SPEECH.isListening()) return;
    const result = SPEECH.stop();
    isRecording = false;
    clearInterval(recordTimerInt);

    // UI updates
    const btn = document.getElementById("recordBtn");
    btn.classList.remove("recording");
    btn.textContent = "🎙";
    document.getElementById("speechStatus").textContent = "🔴 Not listening";
    document.getElementById("speechStatus").style.color = "var(--text-muted)";
    document.getElementById("speakingWave").classList.remove("active");

    const transcript = result.transcript || "";
    if (transcript.trim().length > 30) {
        showNotification(`✅ Recorded ${SPEECH.wordCount()} words — ready for notes!`, "success");
    } else {
        showNotification("Recording stopped.", "info");
    }
}

function pauseRecording() {
    SPEECH.pause();
    document.getElementById("speakingWave").classList.remove("active");
    document.getElementById("speechStatus").textContent = "⏸ Paused";
}

// ── Speech API Callbacks ────────────────────────────────────────────────────
function handleSpeechInterim(interim, full) {
    const body = document.getElementById("liveTranscriptBody");
    if (!body) return;
    body.innerHTML =
        `<span class="transcript-committed">${escapeHtml(full)}</span>` +
        (interim ? `<span class="transcript-interim">${escapeHtml(interim)}</span>` : "") +
        `<span class="transcript-cursor"></span>`;
    body.scrollTop = body.scrollHeight;

    const wc = (full + " " + interim).trim().split(/\s+/).filter(w => w).length;
    document.getElementById("liveWordCount").textContent = wc + " words";
}

function handleSpeechCommit(full, chunk) {
    handleSpeechInterim("", full);
    // Send chunk to backend for storage
    if (activeSessionIdForTranscript) {
        API_CLIENT.storeTranscript(activeSessionIdForTranscript, chunk).catch(() => { });
    }
}

let activeSessionIdForTranscript = null;

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Use live transcript as lecture notes input ──────────────────────────────
function useTranscriptForNotes() {
    const transcript = SPEECH.getTranscript().trim();
    if (!transcript) {
        showNotification("No transcript recorded yet. Start speaking first!", "error");
        return;
    }
    document.getElementById("lectureText").value = transcript;
    updateWordCount(document.getElementById("lectureText"));
    const topic = document.getElementById("topicInput");
    if (!topic.value.trim()) topic.value = "Lecture Transcript";
    switchInputMode("text", document.getElementById("tabText"));
    document.getElementById("tabText").classList.add("active");
    showNotification(`✅ ${SPEECH.wordCount()} words moved to notes input!`, "success");
}

function clearLiveTranscript() {
    SPEECH.clearTranscript();
    const body = document.getElementById("liveTranscriptBody");
    if (body) body.innerHTML = `<span style="color:var(--text-muted);font-style:italic">Start speaking — your words will appear here in real-time...</span>`;
    document.getElementById("liveWordCount").textContent = "0 words";
}

// ── Waveform (visual only) ──────────────────────────────────────────────────
function initWaveform() {
    const wf = document.getElementById("waveformDisplay");
    if (!wf) return;
    wf.innerHTML = "";
    for (let i = 0; i < 16; i++) {
        const bar = document.createElement("div");
        bar.className = "wave-bar";
        bar.style.height = "4px";
        wf.appendChild(bar);
    }
}


// ── File upload ─────────────────────────────────────────────────────────────
function handleDragOver(e) { e.preventDefault(); document.getElementById("uploadZone").classList.add("drag-over"); }
function handleDragLeave() { document.getElementById("uploadZone").classList.remove("drag-over"); }
function handleDrop(e) {
    e.preventDefault();
    document.getElementById("uploadZone").classList.remove("drag-over");
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
}
function handleFileUpload(input) { if (input.files[0]) processFile(input.files[0]); }

function processFile(file) {
    const zone = document.getElementById("uploadZone");
    zone.classList.add("has-file");
    zone.querySelector(".upload-title").textContent = `✅ ${file.name}`;
    zone.querySelector(".upload-sub").textContent = `${(file.size / 1024).toFixed(1)} KB`;

    // If it's a .txt file, read its content
    if (file.name.endsWith(".txt")) {
        const reader = new FileReader();
        reader.onload = e => {
            document.getElementById("lectureText").value = e.target.result;
            updateWordCount(document.getElementById("lectureText"));
            switchInputMode("text", document.getElementById("tabText"));
            document.getElementById("tabText").classList.add("active");
            showNotification(`${file.name} loaded into text area!`, "success");
        };
        reader.readAsText(file);
    } else {
        document.getElementById("uploadedFileInfo").style.display = "block";
        document.getElementById("uploadedFileInfo").innerHTML = `
      <div style="background:rgba(0,255,179,0.06);border:1px solid rgba(0,255,179,0.2);border-radius:12px;padding:14px;font-size:0.85rem;color:var(--text-secondary)">
        📎 <strong>${file.name}</strong> — For audio/video/PDF, backend processing would be used in production.
        <button class="btn btn-success" style="margin-top:8px;width:100%;justify-content:center"
          onclick="loadSampleText()">Use Sample Text Instead</button>
      </div>`;
        showNotification(`${file.name} uploaded — use text mode for demo`, "info");
    }
}

// ── Main: Send to Python backend for NLP ───────────────────────────────────
async function processLecture() {
    let content = "";
    if (currentInputMode === "text") {
        content = document.getElementById("lectureText")?.value.trim() || "";
    } else {
        content = document.getElementById("lectureText")?.value.trim() || "";
    }

    if (content.length < 30) {
        showNotification("Please enter at least 30 characters of content.", "error");
        return;
    }

    const topic = document.getElementById("topicInput")?.value.trim() || "Lecture";
    const style = document.getElementById("noteStyle")?.value || "detailed";
    const language = document.getElementById("langSetting")?.value || "English";
    const audience = document.getElementById("audienceSetting")?.value || "Undergraduate";

    // Show processing animation
    document.getElementById("processBtn").disabled = true;
    document.getElementById("processingCard").classList.add("active");
    document.getElementById("resultsSection").style.display = "none";

    // Step animation
    const steps = ["pStep1", "pStep2", "pStep3", "pStep4"];
    const progs = ["pProg1", "pProg2", "pProg3", "pProg4"];
    let stepDelay = 0;
    steps.forEach((sid, i) => {
        setTimeout(() => {
            if (i > 0) {
                document.getElementById(steps[i - 1]).className = "processing-step step-done";
                document.getElementById(progs[i - 1]).textContent = "100%";
            }
            document.getElementById(sid).className = "processing-step step-active";
            // animate progress bar
            let p = 0;
            const iv = setInterval(() => {
                p = Math.min(99, p + Math.random() * 15 + 5);
                document.getElementById(progs[i]).textContent = Math.round(p) + "%";
                if (p >= 99) clearInterval(iv);
            }, 100);
        }, stepDelay);
        stepDelay += i === steps.length - 1 ? 400 : 700;
    });

    try {
        // ── Call Python NLP backend ──────────────────────────────────────
        const data = await API_CLIENT.processLecture({ content, topic, style, language, audience });

        // Mark all steps done
        steps.forEach((sid, i) => {
            document.getElementById(sid).className = "processing-step step-done";
            document.getElementById(progs[i]).textContent = "100%";
        });

        currentLectureId = data.id;
        currentNoteData = data;

        // Update stats
        document.getElementById("statsWords").textContent = data.word_count;
        document.getElementById("statsConcepts").textContent = data.keywords?.length || 0;
        document.getElementById("statsQA").textContent = data.qa?.length || 0;
        document.getElementById("noteStats").textContent =
            `${data.word_count} words · ${data.keywords?.length || 0} concepts`;

        setTimeout(() => {
            document.getElementById("processingCard").classList.remove("active");
            document.getElementById("processBtn").disabled = false;
            document.getElementById("resultsSection").style.display = "flex";
            document.getElementById("exportSection").style.display = "block";
            document.getElementById("clearBtn").style.display = "flex";

            // Show first tab
            switchNoteTab("summary", document.querySelector(".notes-tab"));
            showNotification(`✅ Notes generated successfully!`, "success");

            // Refresh history panel
            loadHistory();
        }, stepDelay + 400);

    } catch (e) {
        steps.forEach((sid, i) => {
            document.getElementById(sid).className = "processing-step step-pending";
            document.getElementById(progs[i]).textContent = "0%";
        });
        document.getElementById("processingCard").classList.remove("active");
        document.getElementById("processBtn").disabled = false;
        showNotification(`Processing failed: ${e.message}`, "error");
    }
}

// ── Note Tab Rendering ──────────────────────────────────────────────────────
function switchNoteTab(tab, btn) {
    currentNoteTab = tab;
    if (btn) {
        document.querySelectorAll(".notes-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    }
    renderNoteContent(tab);
}

function renderNoteContent(tab) {
    const data = currentNoteData;
    if (!data) return;
    const body = document.getElementById("notesBody");
    const title = document.getElementById("notesTitle");
    const subtitle = document.getElementById("notesSubtitle");

    if (tab === "summary") {
        title.textContent = `📋 ${data.topic} — Summary`;
        subtitle.textContent = `AI-generated · ID #${data.id}`;
        body.innerHTML = renderMarkdown(data.summary || "");
    } else if (tab === "concepts") {
        title.textContent = `🔑 Key Concepts`;
        subtitle.textContent = `${data.keywords?.length || 0} concepts extracted by Python NLP`;
        body.innerHTML = buildConceptsHTML(data);
    } else if (tab === "qa") {
        title.textContent = `❓ Q&A Bank`;
        subtitle.textContent = `${data.qa?.length || 0} pairs generated`;
        body.innerHTML = buildQAHTML(data);
        document.querySelectorAll(".qa-question").forEach(q => {
            q.addEventListener("click", () => q.closest(".qa-item").classList.toggle("open"));
        });
    } else if (tab === "mindmap") {
        title.textContent = `🗺 Mind Map`;
        subtitle.textContent = `Visual concept map from Python NLP`;
        body.innerHTML = `<canvas id="mindmapCanvas" style="width:100%;max-height:480px"></canvas>`;
        setTimeout(() => drawMindMap(data), 60);
    } else if (tab === "full") {
        title.textContent = `📄 Full Notes`;
        subtitle.textContent = `Complete notes stored in database`;
        body.innerHTML = renderMarkdown(data.full_notes || data.summary || "");
    }
}

// ── Simple Markdown renderer ────────────────────────────────────────────────
function renderMarkdown(md) {
    if (!md) return "<p style='color:var(--text-muted)'>No content.</p>";
    const lines = md.split("\n");
    let html = "";
    lines.forEach(line => {
        if (line.startsWith("# ")) html += `<div class="note-h1">${line.slice(2)}</div>`;
        else if (line.startsWith("## ")) html += `<div class="note-h2">${line.slice(3)}</div>`;
        else if (line.startsWith("> ")) html += `<div class="note-highlight">${line.slice(2)}</div>`;
        else if (line.startsWith("- ")) html += `<li class="note-li">${_inlineMd(line.slice(2))}</li>`;
        else if (line.trim() === "") html += "";
        else html += `<div class="note-p">${_inlineMd(line)}</div>`;
    });
    return `<div class="note-content">${html}</div>`;
}

function _inlineMd(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, (_, t) => `<span class="note-keyword">${t}</span>`)
        .replace(/`(.+?)`/g, (_, t) => `<code style="background:rgba(108,99,255,0.15);padding:2px 6px;border-radius:4px">${t}</code>`);
}

// ── Concepts panel ──────────────────────────────────────────────────────────
const CONCEPT_ICONS = ["🧠", "⚡", "🔬", "🎯", "🔗", "📊", "🌐", "🔮", "⚙️", "📐", "🔄", "🏗️", "💡", "🧩", "🔱", "🌀", "🖥️", "📡"];

function buildConceptsHTML(data) {
    const chips = (data.keywords || []).map((k, i) => `
    <div class="concept-chip" onclick="showConceptDef('${k.replace(/'/g, "\\'")}',${i})">
      <span class="concept-icon">${CONCEPT_ICONS[i % CONCEPT_ICONS.length]}</span>${k}
    </div>`).join("");
    return `
    <div style="margin-bottom:20px">
      <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:16px">
        ${data.keywords?.length || 0} concepts extracted by Python NLP · stored in database
      </p>
      <div class="concepts-grid">${chips}</div>
    </div>
    <div id="conceptDef" style="display:none;margin-top:20px;background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.2);border-radius:12px;padding:16px">
      <div id="conceptDefContent"></div>
    </div>`;
}

function showConceptDef(concept, idx) {
    const box = document.getElementById("conceptDef");
    document.getElementById("conceptDefContent").innerHTML = `
    <div style="font-weight:700;color:var(--purple-light);margin-bottom:8px">📖 ${concept}</div>
    <div style="font-size:0.88rem;color:var(--text-secondary)">
      A core concept in <em>${currentNoteData?.topic || "this lecture"}</em>.
      <strong class="note-keyword">${concept}</strong> is an important term extracted by the
      Python NLP engine from your lecture transcript and stored in the
      <code style="background:rgba(108,99,255,0.15);padding:2px 6px;border-radius:4px">concepts</code>
      table.
    </div>`;
    box.style.display = "block";
}

// ── Q&A panel ───────────────────────────────────────────────────────────────
function buildQAHTML(data) {
    return `<div class="qa-list">${(data.qa || []).map((qa, i) => `
      <div class="qa-item">
        <div class="qa-question">
          <span class="qa-q-icon">Q${i + 1}</span>
          <span class="qa-q-text">${qa.question || qa.q}</span>
          <div class="qa-chevron">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        <div class="qa-answer"><p>${qa.answer || qa.a}</p></div>
      </div>`).join("")
        }</div>`;
}

// ── Mind Map ─────────────────────────────────────────────────────────────────
function drawMindMap(data) {
    const canvas = document.getElementById("mindmapCanvas");
    if (!canvas) return;
    const W = canvas.width = canvas.offsetWidth || 600;
    const H = canvas.height = Math.min(480, W * 0.65);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "#0D0D1A";
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const mainR = Math.min(60, W * 0.08);
    const nodeR = Math.min(42, W * 0.056);
    const dist = Math.min(180, W * 0.26);
    const colors = ["#6C63FF", "#00D4FF", "#00FFB3", "#FFB347", "#FF6B6B", "#C77DFF", "#FF6EC7", "#9B93FF"];
    const concepts = (data.keywords || []).slice(0, 8);

    concepts.forEach((concept, i) => {
        const angle = (i / concepts.length) * Math.PI * 2 - Math.PI / 2;
        const nx = cx + Math.cos(angle) * dist;
        const ny = cy + Math.sin(angle) * dist;
        const color = colors[i % colors.length];

        // Line
        const grad = ctx.createLinearGradient(cx, cy, nx, ny);
        grad.addColorStop(0, "rgba(108,99,255,0.4)");
        grad.addColorStop(1, color + "40");
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.moveTo(cx, cy);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        ctx.setLineDash([]);

        // Node
        ctx.beginPath();
        ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
        ctx.fillStyle = color + "22";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Text
        ctx.fillStyle = color;
        ctx.font = `600 ${Math.max(10, W * 0.013)}px Inter`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = concept.length > 11 ? concept.substring(0, 10) + "…" : concept;
        ctx.fillText(label, nx, ny);
    });

    // Central node
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, mainR);
    cg.addColorStop(0, "rgba(108,99,255,0.6)");
    cg.addColorStop(1, "rgba(108,99,255,0.15)");
    ctx.beginPath();
    ctx.arc(cx, cy, mainR, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = "#6C63FF";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.max(11, W * 0.016)}px Outfit`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((data.topic || "Topic").substring(0, 14), cx, cy);
}

// ── Lecture History (from SQLite) ───────────────────────────────────────────
async function loadHistory() {
    try {
        const lectures = await API_CLIENT.listLectures();
        const list = document.getElementById("historyList");
        if (!list) return;

        if (!lectures.length) {
            list.innerHTML = `<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:16px">
        No lectures yet. Generate your first!
      </div>`;
            return;
        }

        const badgeClasses = ["badge-purple", "badge-success", "badge-info", "badge-warning"];
        list.innerHTML = lectures.map((l, i) => `
      <div class="history-item" onclick="loadHistoryLecture(${l.id})">
        <span class="history-icon">📋</span>
        <div class="history-info">
          <div class="history-title">${l.topic}</div>
          <div class="history-meta">${l.word_count} words · ${_relTime(l.created_at)}</div>
        </div>
        <span class="badge ${badgeClasses[i % badgeClasses.length]}" style="font-size:0.7rem">Saved</span>
      </div>`).join("");
    } catch (e) {
        console.warn("load history:", e.message);
    }
}

async function loadHistoryLecture(id) {
    try {
        showNotification("Loading lecture from database…", "info", 1500);
        const data = await API_CLIENT.getLecture(id);
        currentLectureId = data.id;
        currentNoteData = { ...data, qa: data.qa?.map(q => ({ question: q.question, answer: q.answer })) };

        // Populate stats
        document.getElementById("statsWords").textContent = data.word_count;
        document.getElementById("statsConcepts").textContent = data.keywords?.length || 0;
        document.getElementById("statsQA").textContent = data.qa?.length || 0;
        document.getElementById("noteStats").textContent =
            `${data.word_count} words · Loaded from history #${id}`;

        document.getElementById("resultsSection").style.display = "flex";
        document.getElementById("exportSection").style.display = "block";
        document.getElementById("clearBtn").style.display = "flex";

        switchNoteTab("summary", document.querySelector(".notes-tab"));
        showNotification(`Lecture "${data.topic}" loaded from database!`, "success");
    } catch (e) {
        showNotification("Failed to load: " + e.message, "error");
    }
}

function _relTime(iso) {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso + "Z").getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return `${Math.floor(h / 24)} days ago`;
}

// Reliable download helper
function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 600);
}

// ── Export ───────────────────────────────────────────────────────────────────
async function exportAs(format) {
    if (!currentNoteData && !currentLectureId) {
        showNotification("Generate notes first.", "error"); return;
    }
    if (format === "pdf") {
        await exportNotesToPDF();
    } else if (format === "txt" || format === "md") {
        if (!currentLectureId) {
            // Fallback: build content from currentNoteData
            const content = buildPlainTextExport();
            const ext = format === 'md' ? 'md' : 'txt';
            const blob = new Blob([content], { type: 'text/plain' });
            const fname = `${(currentNoteData?.topic || 'lecture_notes').replace(/[^a-z0-9]/gi, '_')}.${ext}`;
            _downloadBlob(blob, fname);
            showNotification(`${ext.toUpperCase()} saved to Downloads!`, 'success');
            return;
        }
        try {
            const res = await API_CLIENT.exportLecture(currentLectureId);
            const ext = format === 'md' ? 'md' : 'txt';
            const content = format === 'md' ? buildMarkdownExport() : res.content;
            const blob = new Blob([content], { type: 'text/plain' });
            _downloadBlob(blob, res.filename.replace('.txt', '.' + ext));
            showNotification(`${ext.toUpperCase()} saved to Downloads!`, 'success');
        } catch (e) {
            // Fallback to local export
            const content = format === "md" ? buildMarkdownExport() : buildPlainTextExport();
            const ext = format === 'md' ? 'md' : 'txt';
            const blob = new Blob([content], { type: 'text/plain' });
            _downloadBlob(blob, `lecture_notes.${ext}`);
            showNotification(`${ext.toUpperCase()} saved to Downloads!`, 'success');
        }
    } else if (format === "docx") {
        // Build a rich text file that can be opened as Word
        const content = buildPlainTextExport();
        const blob = new Blob([content], { type: 'application/msword' });
        const fname = `${(currentNoteData?.topic || 'lecture_notes').replace(/[^a-z0-9]/gi, '_')}.doc`;
        _downloadBlob(blob, fname);
        showNotification('Word document saved to Downloads!', 'success');
    } else if (format === "anki") {
        // Build Anki-compatible tab-separated CSV
        const qa = currentNoteData?.qa || [];
        if (!qa.length) { showNotification("No Q&A data to export.", "error"); return; }
        const content = qa.map(q => `${(q.question || q.q) || ''}\t${(q.answer || q.a) || ''}`).join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const fname = `${(currentNoteData?.topic || 'anki_deck').replace(/[^a-z0-9]/gi, '_')}_anki.txt`;
        _downloadBlob(blob, fname);
        showNotification('Anki deck saved to Downloads — import as .txt in Anki!', 'success');
    } else {
        showNotification(`${format.toUpperCase()} export not available in this mode.`, "info");
    }
}

function buildPlainTextExport() {
    const d = currentNoteData;
    if (!d) return "";
    const lines = [
        `SMARTCLASS AI — LECTURE NOTES`,
        `==============================`,
        `Topic: ${d.topic || "Lecture"}`,
        `Date:  ${new Date().toLocaleDateString("en-IN")}`,
        `Words: ${d.word_count || 0}  |  Concepts: ${(d.keywords || []).length}  |  Q&A: ${(d.qa || []).length}`,
        ``,
        `SUMMARY`,
        `-------`,
        (d.summary || "").replace(/#+\s*/g, "").replace(/\*\*/g, "").replace(/>\s*/g, ""),
        ``,
        `KEY CONCEPTS`,
        `------------`,
        (d.keywords || []).map((k, i) => `${i + 1}. ${k}`).join("\n"),
        ``,
        `FULL NOTES`,
        `----------`,
        (d.full_notes || d.summary || "").replace(/#+\s*/g, "").replace(/\*\*/g, ""),
        ``,
        `Q&A BANK`,
        `--------`,
        ...(d.qa || []).map((qa, i) => `Q${i + 1}: ${qa.question || qa.q}\nA: ${qa.answer || qa.a}\n`),
        ``,
        `Generated by SmartClass AI — ${new Date().toLocaleString("en-IN")}`,
    ];
    return lines.join("\n");
}

function buildMarkdownExport() {
    const d = currentNoteData;
    if (!d) return "";
    const lines = [
        `# ${d.topic || "Lecture Notes"}`,
        ``,
        `> **SmartClass AI** — Generated on ${new Date().toLocaleDateString("en-IN")}  `,
        `> ${d.word_count || 0} words · ${(d.keywords || []).length} concepts · ${(d.qa || []).length} Q&A pairs`,
        ``,
        `## 📋 Summary`,
        ``,
        d.summary || "",
        ``,
        `## 🔑 Key Concepts`,
        ``,
        (d.keywords || []).map(k => `- **${k}**`).join("\n"),
        ``,
        `## 📄 Full Notes`,
        ``,
        d.full_notes || d.summary || "",
        ``,
        `## ❓ Q&A Bank`,
        ``,
        ...(d.qa || []).map((qa, i) => [
            `**Q${i + 1}: ${qa.question || qa.q}**`,
            ``,
            `${qa.answer || qa.a}`,
            ``
        ]).flat(),
        ``,
        `---`,
        `*Generated by SmartClass AI Lecture Note Engine*`,
    ];
    return lines.join("\n");
}


async function copyNotes() {
    const body = document.getElementById("notesBody");
    if (!body) return;
    try {
        await navigator.clipboard.writeText(body.innerText);
        showNotification("Notes copied to clipboard!", "success");
    } catch {
        showNotification("Select text manually to copy.", "error");
    }
}

function showExportModal() {
    const modal = document.getElementById("exportModal");
    modal.style.display = "flex";
}
function hideExportModal() {
    const modal = document.getElementById("exportModal");
    modal.style.display = "none";
}
// Alias so both names work
window.closeExportModal = hideExportModal;

async function regenerate() {
    if (!currentNoteData) return;
    showNotification("Re-generating with Python NLP…", "info");
    renderNoteContent(currentNoteTab);
    setTimeout(() => showNotification("View refreshed!", "success"), 600);
}

async function clearAll() {
    document.getElementById("lectureText").value = "";
    document.getElementById("topicInput").value = "";
    document.getElementById("wordCount").textContent = "0 words";
    document.getElementById("resultsSection").style.display = "none";
    document.getElementById("exportSection").style.display = "none";
    document.getElementById("clearBtn").style.display = "none";
    document.getElementById("noteStats").textContent = "";
    currentLectureId = null;
    currentNoteData = null;
    showNotification("Cleared — ready for new lecture.", "info");
}

// ── PDF Export (jsPDF — no API/server needed, runs in browser) ───────────────
async function exportNotesToPDF() {
    if (!currentNoteData) {
        showNotification("Generate notes first, then save as PDF.", "error");
        return;
    }

    if (typeof window.jspdf === "undefined" && typeof jsPDF === "undefined") {
        showNotification("PDF library loading… try again in a second.", "error");
        return;
    }

    showNotification("📄 Building PDF…", "info", 2000);

    try {
        const { jsPDF } = window.jspdf || { jsPDF: window.jsPDF };
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 18;
        const contentW = pageW - margin * 2;
        let y = margin;

        const brand = "SmartClass AI";
        const topic = currentNoteData.topic || "Lecture Notes";
        const dateStr = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

        // ── Header bar ──────────────────────────────────────────────────────
        doc.setFillColor(108, 99, 255);
        doc.rect(0, 0, pageW, 26, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(brand, margin, 16);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text("Lecture Note Engine", margin, 22);
        doc.text(dateStr, pageW - margin, 16, { align: "right" });

        y = 38;

        // ── Lecture Title ────────────────────────────────────────────────────
        doc.setTextColor(20, 20, 40);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        const titleLines = doc.splitTextToSize(topic, contentW);
        doc.text(titleLines, margin, y);
        y += titleLines.length * 8 + 4;

        // ── Subtitle / stats ─────────────────────────────────────────────────
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 160);
        doc.text(
            `${currentNoteData.word_count || 0} words processed  ·  ${(currentNoteData.keywords || []).length} concepts  ·  ${(currentNoteData.qa || []).length} Q&A pairs`,
            margin, y
        );
        y += 4;

        // ── Divider ──────────────────────────────────────────────────────────
        doc.setDrawColor(200, 200, 220);
        doc.setLineWidth(0.4);
        doc.line(margin, y, pageW - margin, y);
        y += 8;

        // ── Helper: add section heading ──────────────────────────────────────
        const addHeading = (text, size = 13, color = [60, 50, 180]) => {
            if (y > pageH - 30) { doc.addPage(); y = margin; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(size);
            doc.setTextColor(...color);
            doc.text(text, margin, y);
            y += size * 0.55 + 3;
        };

        const addBody = (text, size = 10) => {
            const lines = doc.splitTextToSize(text, contentW - 4);
            lines.forEach(line => {
                if (y > pageH - 20) { doc.addPage(); y = margin; }
                doc.setFont("helvetica", "normal");
                doc.setFontSize(size);
                doc.setTextColor(40, 40, 60);
                doc.text(line, margin + 2, y);
                y += size * 0.48 + 1.5;
            });
            y += 2;
        };

        // ── SECTION 1: Summary ───────────────────────────────────────────────
        addHeading("📋 Lecture Summary");
        const summaryText = (currentNoteData.summary || "")
            .replace(/#+\s*/g, "").replace(/\*\*/g, "").replace(/>\s*/g, "");
        addBody(summaryText);

        // ── SECTION 2: Key Concepts ──────────────────────────────────────────
        if (y > pageH - 40) { doc.addPage(); y = margin; }
        doc.setDrawColor(200, 200, 220);
        doc.line(margin, y, pageW - margin, y);
        y += 6;
        addHeading("🔑 Key Concepts", 13);

        const keywords = currentNoteData.keywords || [];
        const colW = contentW / 3;
        keywords.forEach((kw, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const kx = margin + col * colW;
            const ky = y + row * 8;
            if (ky + 8 > pageH - 20) return;
            doc.setFillColor(240, 238, 255);
            doc.roundedRect(kx, ky - 4, colW - 3, 7, 1.5, 1.5, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            doc.setTextColor(80, 60, 200);
            doc.text(kw.substring(0, 22), kx + 3, ky);
        });
        y += Math.ceil(keywords.length / 3) * 8 + 6;

        // ── SECTION 3: Full Notes ────────────────────────────────────────────
        if (y > pageH - 50) { doc.addPage(); y = margin; }
        doc.setDrawColor(200, 200, 220);
        doc.line(margin, y, pageW - margin, y);
        y += 6;
        addHeading("📄 Full Notes", 13);
        const fullText = (currentNoteData.full_notes || currentNoteData.summary || "")
            .replace(/#+\s*/g, "").replace(/\*\*/g, "");
        addBody(fullText, 9.5);

        // ── SECTION 4: Q&A ───────────────────────────────────────────────────
        const qaList = currentNoteData.qa || [];
        if (qaList.length > 0) {
            if (y > pageH - 50) { doc.addPage(); y = margin; }
            doc.setDrawColor(200, 200, 220);
            doc.line(margin, y, pageW - margin, y);
            y += 6;
            addHeading("❓ Q & A Bank", 13);
            qaList.forEach((qa, i) => {
                if (y > pageH - 25) { doc.addPage(); y = margin; }
                addHeading(`Q${i + 1}: ${qa.question || qa.q}`, 10, [60, 50, 180]);
                const ans = (qa.answer || qa.a || "").replace(/\*\*/g, "");
                addBody("A: " + ans, 9.5);
                y += 1;
            });
        }

        // ── Footer on every page ─────────────────────────────────────────────
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.setTextColor(160, 160, 180);
            doc.text(`SmartClass AI — ${topic} — Page ${i} of ${totalPages}`, pageW / 2, pageH - 8, { align: "center" });
            doc.text("Generated by SmartClass AI Lecture Note Engine (Local SQLite)", margin, pageH - 8);
        }

        // ── Save PDF ─────────────────────────────────────────────────────────
        const safeName = topic.replace(/[^a-z0-9]/gi, "_").substring(0, 40);
        doc.save(`${safeName}_lecture_notes.pdf`);
        showNotification("✅ PDF saved successfully!", "success");

    } catch (err) {
        console.error("PDF export error:", err);
        showNotification("PDF export failed: " + err.message, "error");
    }
}


/* ============================================================
   CAMERA ENGINE — Body Posture Detection (NOT Facial Recognition)
   Uses MediaPipe Pose to track body + head position.
   Detects: Listening, Looking Down, Turned Away, Not Focused.
   NO face recognition — only body skeleton tracking.
   ============================================================ */

// ── CDN URLs for MediaPipe Pose ────────────────────────────────────────────
const MP_POSE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js";
const MP_CAMERA_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js";
const MP_DRAW_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js";

// ── State ──────────────────────────────────────────────────────────────────
let cameraStream = null;
let mpPose = null;           // MediaPipe Pose instance
let mpCamera = null;         // MediaPipe Camera helper
let poseReady = false;
let cameraEnabled = false;
let isFullscreen = false;
let detectionActive = false;

// Latest detection result
let lastPoseResult = null;    // { status, label, icon, score, details }
let lastLandmarks = null;     // raw MediaPipe landmarks
let poseHistory = [];         // rolling history for smoothing
const HISTORY_LEN = 8;        // frames to average

// Status tracking for backend
let tickBuffer = [];
let tickTimer = null;

// Callbacks (set by behaviour.js)
window.onCameraFaceData = null;
window.onCameraError = null;
window.onPostureData = null;

// ── Load MediaPipe scripts dynamically ─────────────────────────────────────
function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
        const s = document.createElement("script");
        s.src = url;
        s.crossOrigin = "anonymous";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Failed to load: " + url));
        document.head.appendChild(s);
    });
}

async function loadMediaPipeScripts() {
    await loadScript(MP_CAMERA_CDN);
    await loadScript(MP_DRAW_CDN);
    await loadScript(MP_POSE_CDN);
    console.log("[Camera] MediaPipe scripts loaded");
}

// ── Initialize MediaPipe Pose ──────────────────────────────────────────────
async function initCamera() {
    try {
        await loadMediaPipeScripts();

        mpPose = new window.Pose({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
        });

        mpPose.setOptions({
            modelComplexity: 1,       // 0=lite, 1=full, 2=heavy
            smoothLandmarks: true,
            enableSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });

        mpPose.onResults(handlePoseResults);
        poseReady = true;
        console.log("[Camera] MediaPipe Pose initialized OK");
        return true;
    } catch (e) {
        console.error("[Camera] Init failed:", e.message);
        if (window.onCameraError) window.onCameraError(e.message);
        return false;
    }
}

// ── Start the webcam feed ──────────────────────────────────────────────────
async function startCamera(videoElement, canvasElement) {
    if (cameraEnabled) return;

    if (!poseReady) {
        const ok = await initCamera();
        if (!ok) throw new Error("Failed to load pose detection models");
    }

    try {
        // Use MediaPipe Camera utility for smooth frame feeding
        mpCamera = new window.Camera(videoElement, {
            onFrame: async () => {
                if (!cameraEnabled || !mpPose) return;
                try {
                    await mpPose.send({ image: videoElement });
                } catch (_) { /* skip frame errors */ }
            },
            width: 640,
            height: 480,
        });

        await mpCamera.start();
        cameraEnabled = true;
        detectionActive = true;

        // Store refs for drawing
        window._poseVideoEl = videoElement;
        window._poseCanvasEl = canvasElement;

        // Start tick timer for backend updates
        tickTimer = setInterval(() => {
            if (tickBuffer.length > 0 && window.onCameraTickBatch) {
                window.onCameraTickBatch([...tickBuffer]);
                tickBuffer = [];
            }
        }, 4000);

        console.log("[Camera] Feed started OK");
    } catch (e) {
        const msg = e.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access."
            : e.name === "NotFoundError"
                ? "No camera found. Please connect a webcam."
                : `Camera error: ${e.message}`;
        if (window.onCameraError) window.onCameraError(msg);
        throw new Error(msg);
    }
}

// ── Stop camera ────────────────────────────────────────────────────────────
function stopCamera() {
    cameraEnabled = false;
    detectionActive = false;
    if (mpCamera) {
        mpCamera.stop();
        mpCamera = null;
    }
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
    lastPoseResult = null;
    lastLandmarks = null;
    poseHistory = [];
    tickBuffer = [];
    console.log("[Camera] Feed stopped");
}

// ══════════════════════════════════════════════════════════════════════════
//  CORE: Analyze pose landmarks to determine Listening / Not Listening
// ══════════════════════════════════════════════════════════════════════════

function handlePoseResults(results) {
    const canvasEl = window._poseCanvasEl;
    const videoEl = window._poseVideoEl;
    if (!canvasEl || !videoEl) return;

    const ctx = canvasEl.getContext("2d");
    const w = videoEl.videoWidth || 640;
    const h = videoEl.videoHeight || 480;

    // Match canvas to video size
    if (canvasEl.width !== w) canvasEl.width = w;
    if (canvasEl.height !== h) canvasEl.height = h;
    ctx.clearRect(0, 0, w, h);

    if (!results.poseLandmarks || results.poseLandmarks.length < 13) {
        // No body detected
        lastPoseResult = {
            status: "no_person",
            label: "No Person Detected",
            icon: "👻",
            score: 0,
            isListening: false,
            details: "No body visible in camera frame",
        };
        lastLandmarks = null;
        drawStatusOverlay(ctx, w, h);
        notifyCallbacks();
        return;
    }

    lastLandmarks = results.poseLandmarks;

    // ── Draw body skeleton on canvas ──
    drawSkeleton(ctx, results.poseLandmarks, w, h);

    // ── Analyze posture ──
    const analysis = analyzePoseForListening(results.poseLandmarks, w, h);

    // ── Smooth with rolling average ──
    poseHistory.push(analysis);
    if (poseHistory.length > HISTORY_LEN) poseHistory.shift();

    const smoothed = smoothAnalysis(poseHistory);
    lastPoseResult = smoothed;

    // ── Draw status overlay ──
    drawStatusOverlay(ctx, w, h);

    // ── Push to callbacks + tick buffer ──
    notifyCallbacks();
}

// ── Analyze body landmarks for listening detection ─────────────────────────
function analyzePoseForListening(landmarks, frameW, frameH) {
    // Key landmarks (MediaPipe Pose indices):
    // 0: nose, 1: left eye inner, 2: left eye, 3: left eye outer
    // 4: right eye inner, 5: right eye, 6: right eye outer
    // 7: left ear, 8: right ear, 9: mouth left, 10: mouth right
    // 11: left shoulder, 12: right shoulder

    const nose = landmarks[0];
    const leftEye = landmarks[2];
    const rightEye = landmarks[5];
    const leftEar = landmarks[7];
    const rightEar = landmarks[8];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];

    // Visibility scores (0-1, higher = more visible)
    const noseVis = nose.visibility || 0;
    const leftEarVis = leftEar.visibility || 0;
    const rightEarVis = rightEar.visibility || 0;
    const leftEyeVis = leftEye.visibility || 0;
    const rightEyeVis = rightEye.visibility || 0;
    const leftShoulderVis = leftShoulder.visibility || 0;
    const rightShoulderVis = rightShoulder.visibility || 0;

    let score = 100;
    let reasons = [];
    let label = "Listening";
    let icon = "✅";
    let status = "listening";

    // ═══════════════════════════════════════════════════════════
    // CHECK 1: TURNED AROUND (back facing camera)
    // If nose is not visible but shoulders are → turned away
    // ═══════════════════════════════════════════════════════════
    if (noseVis < 0.3 && (leftShoulderVis > 0.5 || rightShoulderVis > 0.5)) {
        score = 5;
        label = "Turned Around";
        icon = "🔄";
        status = "turned_away";
        reasons.push("Back facing camera");
        return { status, label, icon, score, isListening: false, details: reasons.join(", "), raw: getRawAngles(landmarks) };
    }

    // ═══════════════════════════════════════════════════════════
    // CHECK 2: HEAD TURNED SIDEWAYS (looking left or right)
    // Compare nose x-position relative to shoulder midpoint
    // ═══════════════════════════════════════════════════════════
    if (noseVis > 0.3 && leftShoulderVis > 0.3 && rightShoulderVis > 0.3) {
        const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
        const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);

        // How far nose is from shoulder center (normalized by shoulder width)
        const noseOffsetX = (nose.x - shoulderMidX) / (shoulderWidth || 0.01);

        if (Math.abs(noseOffsetX) > 0.5) {
            score = Math.max(5, Math.round(50 - Math.abs(noseOffsetX) * 80));
            label = noseOffsetX < 0 ? "Looking Right" : "Looking Left";
            icon = noseOffsetX < 0 ? "👉" : "👈";
            status = "looking_sideways";
            reasons.push(`Head turned ${label.split(" ")[1].toLowerCase()} (offset: ${Math.round(noseOffsetX * 100)}%)`);
        } else if (Math.abs(noseOffsetX) > 0.25) {
            score -= Math.round(Math.abs(noseOffsetX) * 60);
            reasons.push(`Slightly turned (${Math.round(Math.abs(noseOffsetX) * 100)}%)`);
        }

        // Also check ear visibility asymmetry (strong indicator of head turn)
        const earDiff = Math.abs(leftEarVis - rightEarVis);
        if (earDiff > 0.5 && Math.abs(noseOffsetX) > 0.15) {
            score -= 20;
            reasons.push("Head rotated (ear asymmetry)");
            if (score < 30 && status === "listening") {
                label = leftEarVis > rightEarVis ? "Looking Right" : "Looking Left";
                icon = leftEarVis > rightEarVis ? "👉" : "👈";
                status = "looking_sideways";
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CHECK 3: LOOKING DOWN
    // If nose is significantly below eye level → looking down
    // Or if nose Y is close to shoulder Y
    // ═══════════════════════════════════════════════════════════
    if (noseVis > 0.3 && leftEyeVis > 0.3 && rightEyeVis > 0.3) {
        const eyeMidY = (leftEye.y + rightEye.y) / 2;
        const noseDropFromEyes = nose.y - eyeMidY;

        // Normal nose is slightly below eyes (~0.03-0.06 in normalized coords)
        // Looking down: nose drops much further
        if (noseDropFromEyes > 0.10) {
            const penalty = Math.min(50, Math.round(noseDropFromEyes * 400));
            score -= penalty;
            reasons.push(`Looking down (drop: ${Math.round(noseDropFromEyes * 100)}%)`);
            if (score < 40 && status === "listening") {
                label = "Looking Down";
                icon = "👇";
                status = "looking_down";
            }
        }
    }

    // Also check nose vs shoulder height
    if (noseVis > 0.3 && leftShoulderVis > 0.3 && rightShoulderVis > 0.3) {
        const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
        const headDrop = nose.y - shoulderMidY;
        // Normally nose is well above shoulders (negative value like -0.15)
        // If close to 0 or positive → head drooping down significantly
        if (headDrop > -0.05) {
            score -= 30;
            reasons.push("Head drooping — very low");
            if (status === "listening") {
                label = "Looking Down";
                icon = "👇";
                status = "looking_down";
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CHECK 4: BODY TURNED (shoulders not facing camera)
    // If shoulder width is very small → body is turned sideways
    // ═══════════════════════════════════════════════════════════
    if (leftShoulderVis > 0.3 && rightShoulderVis > 0.3) {
        const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
        if (shoulderWidth < 0.08) {
            score -= 30;
            reasons.push("Body turned sideways (narrow shoulders)");
            if (status === "listening") {
                label = "Body Turned";
                icon = "🔄";
                status = "body_turned";
            }
        } else if (shoulderWidth < 0.15) {
            score -= 15;
            reasons.push("Body partially turned");
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CHECK 5: HEAD TILT (tilted sideways)
    // Compare eye Y positions
    // ═══════════════════════════════════════════════════════════
    if (leftEyeVis > 0.3 && rightEyeVis > 0.3) {
        const eyeTilt = Math.abs(leftEye.y - rightEye.y);
        const eyeSpan = Math.abs(leftEye.x - rightEye.x) || 0.01;
        const tiltRatio = eyeTilt / eyeSpan;
        if (tiltRatio > 0.3) {
            score -= Math.min(25, Math.round(tiltRatio * 50));
            reasons.push(`Head tilted (${Math.round(tiltRatio * 100)}%)`);
            if (score < 35 && status === "listening") {
                label = "Head Tilted";
                icon = "↗";
                status = "head_tilted";
            }
        }
    }

    // ── Clamp score ──
    score = Math.max(0, Math.min(100, score));

    // ── Final classification ──
    const isListening = score >= 60 && status === "listening";

    if (status === "listening" && score < 60) {
        label = "Distracted";
        icon = "⚡";
        status = "distracted";
    }

    return {
        status,
        label,
        icon,
        score,
        isListening,
        details: reasons.length > 0 ? reasons.join(", ") : "Good posture — facing forward",
        raw: getRawAngles(landmarks),
    };
}

function getRawAngles(landmarks) {
    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftEar = landmarks[7];
    const rightEar = landmarks[8];
    const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
    const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
    return {
        noseOffset: Math.round(((nose.x - shoulderMidX) / (shoulderWidth || 0.01)) * 100),
        shoulderWidth: Math.round(shoulderWidth * 100),
        noseVis: Math.round((nose.visibility || 0) * 100),
        earBalance: Math.round(((leftEar.visibility || 0) - (rightEar.visibility || 0)) * 100),
    };
}

// ── Smooth analysis over rolling window ────────────────────────────────────
function smoothAnalysis(history) {
    if (!history.length) return null;

    // Use most recent status label (majority vote from last 5 frames)
    const recent = history.slice(-5);
    const statusCounts = {};
    recent.forEach(h => {
        statusCounts[h.status] = (statusCounts[h.status] || 0) + 1;
    });
    const dominantStatus = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])[0][0];
    const representative = recent.filter(h => h.status === dominantStatus).pop() || history[history.length - 1];

    // Average the score
    const avgScore = Math.round(history.reduce((s, h) => s + h.score, 0) / history.length);

    return {
        ...representative,
        score: avgScore,
        isListening: avgScore >= 60 && dominantStatus === "listening",
    };
}

// ── Draw body skeleton on canvas ───────────────────────────────────────────
function drawSkeleton(ctx, landmarks, w, h) {
    if (!landmarks) return;

    const connections = [
        [11, 12], // shoulders
        [11, 13], [13, 15], // left arm
        [12, 14], [14, 16], // right arm
        [11, 23], [12, 24], // torso
        [23, 24], // hips
        [0, 1], [1, 2], [2, 3], // left face
        [0, 4], [4, 5], [5, 6], // right face
        [0, 7], [0, 8], // ears
    ];

    // Draw connections
    ctx.strokeStyle = "rgba(108, 99, 255, 0.6)";
    ctx.lineWidth = 2;
    connections.forEach(([i, j]) => {
        if (i < landmarks.length && j < landmarks.length) {
            const a = landmarks[i];
            const b = landmarks[j];
            if ((a.visibility || 0) > 0.3 && (b.visibility || 0) > 0.3) {
                ctx.beginPath();
                ctx.moveTo(a.x * w, a.y * h);
                ctx.lineTo(b.x * w, b.y * h);
                ctx.stroke();
            }
        }
    });

    // Draw key landmark dots
    const keyPoints = [0, 2, 5, 7, 8, 11, 12]; // nose, eyes, ears, shoulders
    keyPoints.forEach(idx => {
        if (idx < landmarks.length) {
            const lm = landmarks[idx];
            if ((lm.visibility || 0) > 0.3) {
                ctx.beginPath();
                ctx.arc(lm.x * w, lm.y * h, 5, 0, Math.PI * 2);
                ctx.fillStyle = idx === 0 ? "#FF6B6B" : "#6C63FF"; // nose=red, others=purple
                ctx.fill();
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
    });
}

// ── Draw status overlay on canvas ──────────────────────────────────────────
function drawStatusOverlay(ctx, w, h) {
    if (!lastPoseResult) return;
    const r = lastPoseResult;

    // ── Big status badge at top ──
    const badgeColor = r.isListening ? "rgba(0, 200, 138, 0.9)"
        : r.status === "turned_away" ? "rgba(239, 68, 68, 0.9)"
            : r.status === "no_person" ? "rgba(100, 100, 100, 0.8)"
                : "rgba(239, 68, 68, 0.85)";

    const badgeText = `${r.icon} ${r.label}`;
    ctx.font = "bold 18px Inter, Arial, sans-serif";
    const tw = ctx.measureText(badgeText).width;
    const bx = (w - tw - 24) / 2;

    // Badge background
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.roundRect(bx, 16, tw + 24, 34, 12);
    ctx.fill();

    // Badge text
    ctx.fillStyle = "#fff";
    ctx.fillText(badgeText, bx + 12, 40);

    // ── Score bar at bottom ──
    const barY = h - 40;
    const barW = w * 0.6;
    const barX = (w - barW) / 2;

    // Bar background
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.roundRect(barX - 10, barY - 8, barW + 20, 32, 10);
    ctx.fill();

    // Bar track
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(barX, barY, barW, 8);

    // Bar fill
    const fillColor = r.score >= 60 ? "#00C88A" : r.score >= 35 ? "#F59E0B" : "#EF4444";
    ctx.fillStyle = fillColor;
    ctx.fillRect(barX, barY, barW * (r.score / 100), 8);

    // Score label
    ctx.font = "bold 12px Inter, Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText(`Attention: ${r.score}%`, barX, barY + 22);

    const detailText = r.details || "";
    if (detailText) {
        ctx.font = "11px Inter, Arial";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        const dtw = ctx.measureText(detailText).width;
        ctx.fillText(detailText, barX + barW - dtw, barY + 22);
    }
}

// ── Notify behaviour.js callbacks ──────────────────────────────────────────
function notifyCallbacks() {
    if (!lastPoseResult) return;

    // Build face-data compatible format for behaviour.js
    const fakeface = {
        faceIdx: 0,
        score: lastPoseResult.score,
        dominant_expression: lastPoseResult.isListening ? "neutral" : "sad",
        dominant_conf: lastPoseResult.score,
        expressions: {
            happy: lastPoseResult.isListening ? 40 : 5,
            sad: lastPoseResult.isListening ? 5 : 30,
            angry: 0,
            fearful: lastPoseResult.status === "distracted" ? 20 : 0,
            disgusted: 0,
            surprised: 0,
            neutral: lastPoseResult.isListening ? 60 : 15,
        },
        posture: {
            postureScore: lastPoseResult.score,
            postureLabel: lastPoseResult.label,
            postureIcon: lastPoseResult.icon,
            isListening: lastPoseResult.isListening,
            isFocusing: lastPoseResult.score >= 50,
            eyesClosed: false,
            tiltDeg: lastPoseResult.raw?.noseOffset || 0,
            yawDeg: lastPoseResult.raw?.noseOffset || 0,
            pitchDeg: 0,
        },
        isListening: lastPoseResult.isListening,
        isFocusing: lastPoseResult.score >= 50,
    };

    const facesArray = lastPoseResult.status === "no_person" ? [] : [fakeface];
    tickBuffer.push(...facesArray);

    if (window.onCameraFaceData) window.onCameraFaceData(facesArray);
    if (window.onPostureData && lastPoseResult.status !== "no_person") {
        window.onPostureData([fakeface.posture]);
    }
}

// ── Fullscreen toggle ──────────────────────────────────────────────────────
function toggleFullscreen() {
    const panel = document.getElementById("cameraPanel") ||
        document.getElementById("cameraSection") ||
        document.querySelector(".camera-card");
    if (!panel) return;
    if (!isFullscreen) {
        if (panel.requestFullscreen) panel.requestFullscreen();
        else if (panel.webkitRequestFullscreen) panel.webkitRequestFullscreen();
        panel.classList.add("camera-fullscreen");
        isFullscreen = true;
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        panel.classList.remove("camera-fullscreen");
        isFullscreen = false;
    }
}

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
        const panel = document.querySelector(".camera-fullscreen");
        if (panel) panel.classList.remove("camera-fullscreen");
        isFullscreen = false;
    }
});

// ── Expression → Metrics (compatible with behaviour.js) ────────────────────
function expressionToMetrics(faces) {
    if (!faces || faces.length === 0) return null;
    const f = faces[0];
    const posture = f.posture || {};
    return {
        engagement: Math.min(100, Math.round(f.expressions.neutral + f.expressions.happy * 0.5)),
        attention: Math.min(100, posture.postureScore || 0),
        participation: Math.min(100, Math.round((f.expressions.happy + f.expressions.neutral) * 0.5)),
        postureScore: posture.postureScore || 0,
        emotions: [posture.isListening ? "🎯 Focusing" : "😴 Not Focused"],
        face_count: 1,
        listening_count: posture.isListening ? 1 : 0,
        focusing_count: posture.isFocusing ? 1 : 0,
        listening_pct: posture.isListening ? 100 : 0,
        focusing_pct: posture.isFocusing ? 100 : 0,
    };
}

// ── Snapshot ────────────────────────────────────────────────────────────────
function captureSnapshot(videoEl) {
    const c = document.createElement("canvas");
    c.width = videoEl.videoWidth; c.height = videoEl.videoHeight;
    c.getContext("2d").drawImage(videoEl, 0, 0);
    return c.toDataURL("image/jpeg", 0.6);
}

// ── Public API ─────────────────────────────────────────────────────────────
window.CAMERA = {
    init: initCamera,
    start: startCamera,
    stop: stopCamera,
    toggleFullscreen,
    snapshot: captureSnapshot,
    expressionToMetrics,
    isReady: () => poseReady,
    isRunning: () => cameraEnabled,
    isFullscreen: () => isFullscreen,
    getLastFaces: () => lastPoseResult && lastPoseResult.status !== "no_person" ? [{
        faceIdx: 0,
        score: lastPoseResult.score,
        dominant_expression: lastPoseResult.isListening ? "neutral" : "sad",
        dominant_conf: lastPoseResult.score,
        expressions: {
            happy: lastPoseResult.isListening ? 40 : 5,
            neutral: lastPoseResult.isListening ? 60 : 15,
            sad: lastPoseResult.isListening ? 5 : 30,
            angry: 0, fearful: 0, disgusted: 0, surprised: 0,
        },
        posture: {
            postureScore: lastPoseResult.score,
            postureLabel: lastPoseResult.label,
            postureIcon: lastPoseResult.icon,
            isListening: lastPoseResult.isListening,
            isFocusing: lastPoseResult.score >= 50,
        },
    }] : [],
    getLastPosture: () => lastPoseResult ? [{
        postureScore: lastPoseResult.score,
        postureLabel: lastPoseResult.label,
        postureIcon: lastPoseResult.icon,
        isListening: lastPoseResult.isListening,
        isFocusing: lastPoseResult.score >= 50,
        tiltDeg: lastPoseResult.raw?.noseOffset || 0,
        yawDeg: lastPoseResult.raw?.noseOffset || 0,
        pitchDeg: 0,
    }] : [],
    getStatus: () => lastPoseResult,
};

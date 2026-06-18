"""
===================================================
Behavior Detector — OpenCV + MediaPipe
===================================================
Detects faces, eye gaze, head pose, and engagement
using the laptop webcam in real-time.

Uses:
  - MediaPipe Face Mesh (468 landmarks)
  - Eye Aspect Ratio (EAR) for blink/drowsiness
  - Head pose estimation for attention detection
  - Engagement scoring from gaze + pose

No model training required — uses pre-trained models.
===================================================
"""

import cv2
import numpy as np
import time
from dataclasses import dataclass, field
from typing import Optional

try:
    import mediapipe as mp
    MP_AVAILABLE = True
except ImportError:
    MP_AVAILABLE = False
    print("[WARNING] MediaPipe not installed. Running in demo mode.")


# ── Data Classes ─────────────────────────────────────────────────────────────
@dataclass
class FaceResult:
    """Represents analysis results for a single detected face."""
    face_index: int = 0
    bbox: tuple = (0, 0, 0, 0)  # x, y, w, h
    # Eye gaze metrics
    left_ear: float = 0.0       # Left Eye Aspect Ratio
    right_ear: float = 0.0      # Right Eye Aspect Ratio
    avg_ear: float = 0.0        # Average EAR
    is_blinking: bool = False
    is_drowsy: bool = False
    # Head pose
    yaw: float = 0.0            # Head rotation left/right (degrees)
    pitch: float = 0.0          # Head tilt up/down (degrees)
    roll: float = 0.0           # Head tilt sideways (degrees)
    head_direction: str = "Forward"
    # Gaze
    gaze_direction: str = "Center"
    is_looking_at_screen: bool = True
    # Scores
    attention_score: float = 0.0
    engagement_status: str = "Unknown"


@dataclass
class ClassroomSnapshot:
    """Aggregated analysis of all detected faces in a frame."""
    timestamp: float = 0.0
    face_count: int = 0
    avg_attention: float = 0.0
    engagement_distribution: dict = field(default_factory=dict)
    faces: list = field(default_factory=list)


# ── MediaPipe Landmark Indices ───────────────────────────────────────────────
# Eye landmarks for EAR calculation (from 468 face mesh points)
LEFT_EYE = [362, 385, 387, 263, 373, 380]
RIGHT_EYE = [33, 160, 158, 133, 153, 144]

# Iris landmarks for gaze estimation
LEFT_IRIS = [474, 475, 476, 477]
RIGHT_IRIS = [469, 470, 471, 472]

# Head pose estimation landmarks (nose, chin, eyes, mouth corners)
POSE_LANDMARKS = [1, 33, 263, 61, 291, 199]


class BehaviorDetector:
    """
    Real-time student behavior detector using MediaPipe Face Mesh.

    Usage:
        detector = BehaviorDetector()
        detector.start()

        while True:
            snapshot = detector.process_frame(frame)
            if snapshot:
                print(f"Attention: {snapshot.avg_attention}%")

        detector.stop()
    """

    def __init__(
        self,
        max_faces: int = 5,
        detection_confidence: float = 0.5,
        tracking_confidence: float = 0.5,
        ear_threshold: float = 0.21,
        drowsy_frames: int = 15,
    ):
        """
        Initialize the behavior detector.

        Args:
            max_faces: Maximum number of faces to detect simultaneously
            detection_confidence: Minimum confidence for face detection
            tracking_confidence: Minimum confidence for face tracking
            ear_threshold: Eye Aspect Ratio threshold for blink detection
            drowsy_frames: Number of consecutive low-EAR frames to flag drowsiness
        """
        self.max_faces = max_faces
        self.ear_threshold = ear_threshold
        self.drowsy_frames = drowsy_frames

        # MediaPipe face mesh
        self.face_mesh = None
        if MP_AVAILABLE:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.mp_drawing = mp.solutions.drawing_utils
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                max_num_faces=max_faces,
                refine_landmarks=True,  # Enables iris landmarks
                min_detection_confidence=detection_confidence,
                min_tracking_confidence=tracking_confidence,
            )

        # State tracking per face
        self._blink_counters = {}  # face_idx -> consecutive low EAR count
        self._attention_history = {}  # face_idx -> list of recent scores

        # Camera model for head pose estimation
        self._camera_matrix = None
        self._dist_coeffs = np.zeros((4, 1), dtype=np.float64)

        # 3D model points for head pose (generic human face proportions)
        self._model_points = np.array([
            (0.0, 0.0, 0.0),       # Nose tip
            (-225.0, 170.0, -135.0), # Left eye corner
            (225.0, 170.0, -135.0),  # Right eye corner
            (-150.0, -150.0, -125.0),# Left mouth corner
            (150.0, -150.0, -125.0), # Right mouth corner
            (0.0, -330.0, -65.0),    # Chin
        ], dtype=np.float64)

    def _ensure_camera_matrix(self, w: int, h: int):
        """Build camera intrinsic matrix based on frame dimensions."""
        if self._camera_matrix is None or self._camera_matrix[0, 2] != w / 2:
            focal = w  # Approximate focal length
            self._camera_matrix = np.array([
                [focal, 0, w / 2],
                [0, focal, h / 2],
                [0, 0, 1],
            ], dtype=np.float64)

    @staticmethod
    def _eye_aspect_ratio(eye_points: list) -> float:
        """
        Calculate Eye Aspect Ratio (EAR).

        EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)

        When the eye is open, EAR is ~0.25-0.30.
        When closed, EAR drops to ~0.05.
        """
        p1, p2, p3, p4, p5, p6 = eye_points
        # Vertical distances
        v1 = np.linalg.norm(np.array(p2) - np.array(p6))
        v2 = np.linalg.norm(np.array(p3) - np.array(p5))
        # Horizontal distance
        h = np.linalg.norm(np.array(p1) - np.array(p4))
        if h == 0:
            return 0.0
        return (v1 + v2) / (2.0 * h)

    def _estimate_head_pose(self, landmarks, w: int, h: int) -> tuple:
        """
        Estimate head pose (yaw, pitch, roll) using solvePnP.

        Returns:
            (yaw, pitch, roll) in degrees
        """
        self._ensure_camera_matrix(w, h)

        # Get 2D image points from face landmarks
        image_points = np.array([
            (landmarks[POSE_LANDMARKS[0]].x * w, landmarks[POSE_LANDMARKS[0]].y * h),
            (landmarks[POSE_LANDMARKS[1]].x * w, landmarks[POSE_LANDMARKS[1]].y * h),
            (landmarks[POSE_LANDMARKS[2]].x * w, landmarks[POSE_LANDMARKS[2]].y * h),
            (landmarks[POSE_LANDMARKS[3]].x * w, landmarks[POSE_LANDMARKS[3]].y * h),
            (landmarks[POSE_LANDMARKS[4]].x * w, landmarks[POSE_LANDMARKS[4]].y * h),
            (landmarks[POSE_LANDMARKS[5]].x * w, landmarks[POSE_LANDMARKS[5]].y * h),
        ], dtype=np.float64)

        try:
            success, rvec, tvec = cv2.solvePnP(
                self._model_points, image_points,
                self._camera_matrix, self._dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE,
            )
            if not success:
                return 0.0, 0.0, 0.0

            rmat, _ = cv2.Rodrigues(rvec)
            angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)
            yaw = angles[1]
            pitch = angles[0]
            roll = angles[2]
            return float(yaw), float(pitch), float(roll)
        except Exception:
            return 0.0, 0.0, 0.0

    def _estimate_gaze(self, landmarks, w: int, h: int) -> tuple:
        """
        Estimate gaze direction from iris position relative to eye corners.

        Returns:
            (gaze_direction: str, is_looking_at_screen: bool)
        """
        try:
            # Left iris center
            left_iris_pts = [(landmarks[i].x * w, landmarks[i].y * h) for i in LEFT_IRIS]
            l_cx = sum(p[0] for p in left_iris_pts) / 4
            l_cy = sum(p[1] for p in left_iris_pts) / 4

            # Left eye corners
            l_inner = (landmarks[362].x * w, landmarks[362].y * h)
            l_outer = (landmarks[263].x * w, landmarks[263].y * h)

            # Horizontal ratio (0=left, 0.5=center, 1=right)
            eye_width = abs(l_outer[0] - l_inner[0])
            if eye_width < 1:
                return "Center", True

            ratio_h = (l_cx - min(l_inner[0], l_outer[0])) / eye_width

            if ratio_h < 0.35:
                return "Right", False   # Looking right (mirrored)
            elif ratio_h > 0.65:
                return "Left", False    # Looking left (mirrored)
            else:
                return "Center", True
        except (IndexError, ZeroDivisionError):
            return "Center", True

    def _head_direction(self, yaw: float, pitch: float) -> str:
        """Classify head direction from yaw and pitch angles."""
        if abs(yaw) > 25:
            return "Left" if yaw < 0 else "Right"
        elif pitch > 15:
            return "Up"
        elif pitch < -15:
            return "Down"
        else:
            return "Forward"

    def _compute_attention(self, face: FaceResult) -> float:
        """
        Compute attention score (0-100) from multiple signals.

        Formula:
          - Gaze weight: 35% (looking at screen)
          - Head pose weight: 30% (facing forward)
          - Eye openness weight: 20% (not drowsy)
          - Stability weight: 15% (head not moving excessively)
        """
        score = 0.0

        # Gaze component (35%)
        if face.is_looking_at_screen:
            score += 35.0
        elif face.gaze_direction in ("Left", "Right"):
            score += 10.0

        # Head pose component (30%)
        yaw_penalty = min(30.0, abs(face.yaw) * 1.0)
        pitch_penalty = min(20.0, abs(face.pitch) * 0.8)
        head_score = max(0, 30.0 - yaw_penalty - pitch_penalty)
        score += head_score

        # Eye openness component (20%)
        if face.is_drowsy:
            score += 0.0
        elif face.is_blinking:
            score += 15.0  # Blinking is normal
        else:
            score += 20.0

        # Stability bonus (15%) — facing forward with good EAR
        if face.head_direction == "Forward" and face.avg_ear > 0.2:
            score += 15.0
        elif face.head_direction == "Forward":
            score += 8.0

        return min(100.0, max(0.0, score))

    def _classify_engagement(self, attention: float) -> str:
        """Classify engagement status from attention score."""
        if attention >= 75:
            return "Focused"
        elif attention >= 50:
            return "Partially Focused"
        elif attention >= 30:
            return "Distracted"
        else:
            return "Very Distracted"

    def process_frame(self, frame: np.ndarray) -> Optional[ClassroomSnapshot]:
        """
        Process a single video frame and return analysis results.

        Args:
            frame: BGR image from OpenCV (numpy array)

        Returns:
            ClassroomSnapshot with per-face and aggregated results
        """
        if frame is None or frame.size == 0:
            return None

        h, w = frame.shape[:2]

        # Demo mode if MediaPipe is not available
        if not MP_AVAILABLE or self.face_mesh is None:
            return self._demo_snapshot()

        # Convert BGR to RGB for MediaPipe
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self.face_mesh.process(rgb)

        if not results.multi_face_landmarks:
            return ClassroomSnapshot(
                timestamp=time.time(),
                face_count=0,
                avg_attention=0.0,
                engagement_distribution={"No faces": 1},
                faces=[],
            )

        faces = []
        for idx, face_landmarks in enumerate(results.multi_face_landmarks):
            lm = face_landmarks.landmark
            face = FaceResult(face_index=idx)

            # ── Bounding box ────────────────────────────────────────────
            xs = [l.x * w for l in lm]
            ys = [l.y * h for l in lm]
            x1, y1, x2, y2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
            face.bbox = (x1, y1, x2 - x1, y2 - y1)

            # ── EAR (Eye Aspect Ratio) ──────────────────────────────────
            left_pts = [(lm[i].x * w, lm[i].y * h) for i in LEFT_EYE]
            right_pts = [(lm[i].x * w, lm[i].y * h) for i in RIGHT_EYE]
            face.left_ear = self._eye_aspect_ratio(left_pts)
            face.right_ear = self._eye_aspect_ratio(right_pts)
            face.avg_ear = (face.left_ear + face.right_ear) / 2.0

            # Blink & drowsiness detection
            face.is_blinking = face.avg_ear < self.ear_threshold
            counter = self._blink_counters.get(idx, 0)
            if face.is_blinking:
                counter += 1
            else:
                counter = 0
            self._blink_counters[idx] = counter
            face.is_drowsy = counter >= self.drowsy_frames

            # ── Head pose ───────────────────────────────────────────────
            face.yaw, face.pitch, face.roll = self._estimate_head_pose(lm, w, h)
            face.head_direction = self._head_direction(face.yaw, face.pitch)

            # ── Gaze direction ──────────────────────────────────────────
            face.gaze_direction, face.is_looking_at_screen = self._estimate_gaze(lm, w, h)

            # ── Attention score ─────────────────────────────────────────
            face.attention_score = self._compute_attention(face)
            face.engagement_status = self._classify_engagement(face.attention_score)

            faces.append(face)

        # ── Aggregate ───────────────────────────────────────────────────
        avg_attention = sum(f.attention_score for f in faces) / len(faces) if faces else 0
        engagement_dist = {}
        for f in faces:
            engagement_dist[f.engagement_status] = engagement_dist.get(f.engagement_status, 0) + 1

        return ClassroomSnapshot(
            timestamp=time.time(),
            face_count=len(faces),
            avg_attention=round(avg_attention, 1),
            engagement_distribution=engagement_dist,
            faces=faces,
        )

    def draw_overlay(self, frame: np.ndarray, snapshot: ClassroomSnapshot) -> np.ndarray:
        """
        Draw analysis overlay on the video frame.

        Args:
            frame: Original BGR frame
            snapshot: Analysis results to visualize

        Returns:
            Frame with overlay drawn
        """
        if snapshot is None:
            return frame

        overlay = frame.copy()

        for face in snapshot.faces:
            x, y, w, h = face.bbox
            # Color based on engagement
            if face.engagement_status == "Focused":
                color = (0, 200, 100)
            elif face.engagement_status == "Partially Focused":
                color = (0, 180, 255)
            elif face.engagement_status == "Distracted":
                color = (0, 140, 255)
            else:
                color = (0, 80, 255)

            # Draw bounding box
            cv2.rectangle(overlay, (x, y), (x + w, y + h), color, 2)

            # Draw attention score
            label = f"Attn: {face.attention_score:.0f}%"
            cv2.putText(overlay, label, (x, y - 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

            # Draw engagement status
            cv2.putText(overlay, face.engagement_status, (x, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

            # Draw gaze direction
            gaze_label = f"Gaze: {face.gaze_direction}"
            cv2.putText(overlay, gaze_label, (x, y + h + 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)

            # Drowsiness warning
            if face.is_drowsy:
                cv2.putText(overlay, "DROWSY!", (x + w - 70, y - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)

        # Draw class average at top
        avg_text = f"Class Attention: {snapshot.avg_attention:.0f}% | Faces: {snapshot.face_count}"
        cv2.putText(overlay, avg_text, (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        return overlay

    def _demo_snapshot(self) -> ClassroomSnapshot:
        """Generate demo data when MediaPipe is not available."""
        import random
        faces = []
        n = random.randint(1, 3)
        for i in range(n):
            att = random.uniform(40, 95)
            face = FaceResult(
                face_index=i,
                bbox=(50 + i * 200, 50, 150, 180),
                avg_ear=random.uniform(0.2, 0.35),
                is_blinking=random.random() < 0.1,
                is_drowsy=random.random() < 0.05,
                yaw=random.uniform(-20, 20),
                pitch=random.uniform(-10, 10),
                roll=random.uniform(-5, 5),
                head_direction="Forward" if random.random() > 0.3 else random.choice(["Left", "Right"]),
                gaze_direction="Center" if random.random() > 0.2 else random.choice(["Left", "Right"]),
                is_looking_at_screen=random.random() > 0.2,
                attention_score=att,
                engagement_status="Focused" if att > 75 else ("Partially Focused" if att > 50 else "Distracted"),
            )
            faces.append(face)
        avg_att = sum(f.attention_score for f in faces) / len(faces)
        return ClassroomSnapshot(
            timestamp=time.time(),
            face_count=len(faces),
            avg_attention=round(avg_att, 1),
            engagement_distribution={f.engagement_status: 1 for f in faces},
            faces=faces,
        )

    def stop(self):
        """Release MediaPipe resources."""
        if self.face_mesh:
            self.face_mesh.close()

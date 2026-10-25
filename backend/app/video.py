"""Video jobs: decode -> SAM 2 tracking in chunks -> edge refine + temporal smoothing -> encode."""
import json
import os
import queue
from collections.abc import Callable
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np

from .config import DATA_DIR, TTL_SECONDS, VIDEO_CHUNK
from .engine import SAM2_MODEL, guided_alpha
from .models import gpu_lock

JOBS_DIR = DATA_DIR / "jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"

MAX_CORRECTIONS = 5
# set by main: (rgb, points, box) -> mask, using the image model's whole-object pick
segment_frame: "Callable[..., np.ndarray] | None" = None
jobs: dict[str, dict] = {}
_q: "queue.Queue[tuple[str, str]]" = queue.Queue()
_predictor = None
_pred_lock = threading.Lock()


class VideoError(Exception):
    pass


def _imread(path, flags=cv2.IMREAD_COLOR) -> np.ndarray:
    img = cv2.imread(str(path), flags)
    if img is None:
        raise VideoError(f"Could not read frame: {path}")
    return img


def _run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise VideoError(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "ffmpeg failed")
    return r.stdout


def probe(path: Path) -> dict:
    out = _run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height,r_frame_rate:format=duration", "-of", "json", str(path)])
    j = json.loads(out)
    s = j["streams"][0]
    num, den = (int(x) for x in s["r_frame_rate"].split("/"))
    return {"width": s["width"], "height": s["height"], "fps": num / den if den else 30.0,
            "duration": float(j["format"].get("duration", 0))}


def predictor():
    global _predictor
    with _pred_lock:
        if _predictor is None:
            import torch
            from sam2.sam2_video_predictor import SAM2VideoPredictor
            _predictor = SAM2VideoPredictor.from_pretrained(
                SAM2_MODEL, device="cuda" if torch.cuda.is_available() else "cpu")
        return _predictor


def available() -> bool:
    try:
        import sam2  # noqa: F401
        return True
    except Exception:
        return False


def create(src: Path, prompt: dict, limits: dict, owner: str) -> dict:
    """Validate and normalise the upload, then queue tracking. Limits come from the job token."""
    if not available():
        raise VideoError("Video needs SAM 2, which isn't installed on this server.")
    info = probe(src)
    max_sec = float(limits.get("sec", 5))
    max_h = int(limits.get("res", 480))
    jid = uuid.uuid4().hex
    d = JOBS_DIR / jid
    (d / "frames").mkdir(parents=True)
    fps = min(30.0, info["fps"] or 30.0)
    h = min(max_h, info["height"])
    h -= h % 2
    vf = f"fps={fps},scale=-2:{h}"
    _run([FFMPEG, "-v", "error", "-i", str(src), "-t", str(max_sec), "-vf", vf, "-q:v", "2",
          "-start_number", "0", str(d / "frames" / "%05d.jpg")])
    _run([FFMPEG, "-v", "error", "-i", str(src), "-t", str(max_sec), "-vn", "-c:a", "libopus", "-b:a", "96k",
          str(d / "audio.ogg")]) if _has_audio(src) else None
    shutil.move(str(src), str(d / f"source{src.suffix}"))
    n = len(list((d / "frames").glob("*.jpg")))
    if n == 0:
        raise VideoError("Couldn't read any frames from that video.")
    first = _imread(str(d / "frames" / "00000.jpg"))
    fh, fw = first.shape[:2]
    job = {
        "id": jid, "type": "video", "status": "queued", "progress": 0.0, "owner": owner,
        "frames": n, "fps": fps, "width": fw, "height": fh,
        "seconds": round(n / fps, 2), "prompts": [_normalize(prompt, fps, fw, fh, n)], "created": time.time(),
        "error": None, "outputs": {},
    }
    _save(job)
    jobs[jid] = job
    _q.put((jid, "track"))
    return public(job)


def correct(jid: str, prompt: dict) -> dict:
    job = jobs.get(jid)
    if not job:
        raise VideoError("Job not found or expired.")
    if job["status"] in ("queued", "running"):
        raise VideoError("Wait for the current run to finish first.")
    if len(job["prompts"]) > MAX_CORRECTIONS:

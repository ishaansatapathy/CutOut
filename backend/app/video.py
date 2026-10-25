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
        raise VideoError(f"This clip has used its {MAX_CORRECTIONS} correction runs.")
    job["prompts"].append(_normalize(prompt, job["fps"], job["width"], job["height"], job["frames"]))
    job["status"], job["progress"], job["outputs"] = "queued", 0.0, {}
    for f in (JOBS_DIR / jid).glob("cutout_*.mp4"):
        f.unlink(missing_ok=True)
    _save(job)
    _q.put((jid, "correct"))
    return public(job)


def _normalize(p: dict, fps: float, w: int, h: int, n: int) -> dict:
    """Browser sends a timestamp and 0-1 coordinates; convert to frame index and pixels of the decoded frames."""
    out = dict(p)
    if "time" in p:
        out["frame"] = int(round(float(p["time"]) * fps))
    out["frame"] = max(0, min(n - 1, int(out.get("frame", 0))))
    if p.get("norm"):
        out["points"] = [{"x": q["x"] * w, "y": q["y"] * h, "label": int(q["label"])} for q in p.get("points", [])]
        if p.get("box"):
            b = p["box"]
            out["box"] = [b[0] * w, b[1] * h, b[2] * w, b[3] * h]
    return out


def public(job: dict) -> dict:
    return {k: job[k] for k in ("id", "type", "status", "progress", "frames", "fps", "width", "height",
                                "seconds", "error")} | {"outputs": sorted(job["outputs"])}


def _has_audio(src: Path) -> bool:
    out = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                          "-of", "csv=p=0", str(src)], capture_output=True, text=True).stdout
    return bool(out.strip())


def _save(job):
    (JOBS_DIR / job["id"] / "job.json").write_text(json.dumps(job))


def _chunks(n: int):
    """Chunk boundaries with one frame of overlap so masks hand over between chunks."""
    out, s = [], 0
    while s < n - 1 or (n == 1 and s == 0):
        e = min(n, s + VIDEO_CHUNK)
        out.append((s, e))
        if e >= n:
            break
        s = e - 1
    return out


def _chunk_dir(d: Path, s: int, e: int) -> Path:
    cd = d / "chunks" / f"{s}_{e}"
    if not cd.exists():
        cd.mkdir(parents=True)
        for i in range(s, e):
            src = d / "frames" / f"{i:05d}.jpg"
            dst = cd / f"{i - s:05d}.jpg"
            try:
                os.link(src, dst)
            except OSError:
                shutil.copy(src, dst)
    return cd


def _prompt_args(p: dict):
    pts = p.get("points") or []
    coords = np.array([[q["x"], q["y"]] for q in pts], np.float32) if pts else None
    labels = np.array([q["label"] for q in pts], np.int32) if pts else None
    box = np.array(p["box"], np.float32) if p.get("box") else None
    return coords, labels, box


def _track_chunk(pred, d, s, e, seed_frame, seed, reverse, masks, report):
    """Propagate inside [s, e). seed is either a prompt dict or a binary mask for seed_frame."""
    import torch
    state = pred.init_state(video_path=str(_chunk_dir(d, s, e)), offload_video_to_cpu=True,
                            offload_state_to_cpu=True)
    local = seed_frame - s
    base_mask, prompt = (seed, None) if isinstance(seed, np.ndarray) else seed if isinstance(seed, tuple) else (None, seed)
    if base_mask is not None:
        pred.add_new_mask(inference_state=state, frame_idx=local, obj_id=1, mask=base_mask > 0)
    if prompt is not None:
        coords, labels, box = _prompt_args(prompt)
        pred.add_new_points_or_box(inference_state=state, frame_idx=local, obj_id=1, points=coords,
                                   labels=labels, box=box, clear_old_points=base_mask is None)
    dirs = [False, True] if reverse is None else [reverse]
    for rev in dirs:
        for fi, _, logits in pred.propagate_in_video(state, start_frame_idx=local, reverse=rev):
            masks[s + fi] = (logits[0, 0] > 0).cpu().numpy()
            report()
    pred.reset_state(state)
    del state
    torch.cuda.empty_cache() if torch.cuda.is_available() else None


def _track(job: dict, start_from: int | None):
    import torch
    d = JOBS_DIR / job["id"]
    mdir = d / "masks"
    mdir.mkdir(exist_ok=True)
    n = job["frames"]
    masks: dict[int, np.ndarray] = {}
    pred = predictor()
    prompt = job["prompts"][-1]
    f0 = max(0, min(n - 1, int(prompt.get("frame", 0))))
    chunks = _chunks(n)
    todo = n if start_from is None else n - f0
    done = [0]

    def report():
        done[0] += 1
        job["progress"] = round(min(0.9, 0.9 * done[0] / max(1, todo)), 3)

    home = next(i for i, (s, e) in enumerate(chunks) if s <= f0 < e)
    seed: object = prompt
    prev_mask = mdir / f"{f0:05d}.png"
    if start_from is not None and prev_mask.exists():
        seed = ((_imread(str(prev_mask), cv2.IMREAD_GRAYSCALE) > 0).astype(np.uint8), prompt)
    elif segment_frame is not None:
        rgb = cv2.cvtColor(_imread(str(d / "frames" / f"{f0:05d}.jpg")), cv2.COLOR_BGR2RGB)
        m = segment_frame(rgb, prompt.get("points") or [], prompt.get("box"))

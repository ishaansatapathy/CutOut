"""CutOut GPU service. Every costly call needs a one-time job token minted by the web server."""
import io
import json
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps, PngImagePlugin

from . import models, video
from .config import MAX_IMAGE_BYTES, MAX_SIDE, MAX_VIDEO_BYTES, TTL_SECONDS
from .engine import compose_rgba, guided_alpha, load_engine, smart_select
from .tokens import require

app = FastAPI(title="CutOut GPU service")
engine = load_engine()


def _select(key: str, rgb, pts: list, box, cache: dict):
    """Single positive click -> whole subject (see smart_select). Anything else -> SAM directly."""
    single = len(pts) == 1 and not box and pts[0]["label"] == 1
    if not single or not hasattr(engine, "candidates"):
        return engine.predict(key, rgb, pts, box)
    masks, scores = engine.candidates(key, rgb, pts, box)
    if "saliency" not in cache:
        cache["saliency"] = models.matting_alpha(rgb)
    return smart_select(masks, scores, cache["saliency"], pts[0])


def _segment_frame(rgb, points, box):
    key = f"video-{uuid.uuid4().hex}"
    engine.set_image(key, rgb)
    return _select(key, rgb, points, box, {})


video.segment_frame = _segment_frame
threading.Thread(target=models.warm, daemon=True).start()
sessions: dict[str, dict] = {}
IMAGE_TOOLS = {"remove", "erase", "upscale"}
MAX_ERASES = 10
MAX_CLICKS = 60


def _gc():
    now = time.time()
    for k in [k for k, s in sessions.items() if now - s["t"] > TTL_SECONDS]:
        del sessions[k]
    video.gc()


def _decode(data: bytes):
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image larger than 20 MB")
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        raise HTTPException(400, "Not a valid image")
    return np.array(img)


def _work_copy(rgb):
    h, w = rgb.shape[:2]
    s = min(1.0, MAX_SIDE / max(h, w))
    small = cv2.resize(rgb, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else rgb
    return small, s


def _png(arr, mode, meta: dict | None = None) -> bytes:
    buf = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    for k, v in (meta or {}).items():
        info.add_text(k, v)
    Image.fromarray(arr, mode).save(buf, "PNG", pnginfo=info)
    return buf.getvalue()


def _flatten(rgba, bg: str | None):
    if not bg:
        return rgba
    c = bg.lstrip("#")
    if len(c) != 6:
        raise HTTPException(400, "Background must be a hex colour")
    color = np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
    a = rgba[..., 3:4].astype(np.float32) / 255
    rgb = rgba[..., :3] * a + color * (1 - a)
    return np.dstack([rgb.astype(np.uint8), np.full(rgba.shape[:2], 255, np.uint8)])


def _session(sid: str, tool: str | None = None) -> dict:
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404, "Session expired. Upload the image again.")
    if tool and s["tool"] != tool:
        raise HTTPException(403, f"This session is for {s['tool']}, not {tool}")
    s["t"] = time.time()
    return s


def _mask(s: dict, body: dict) -> np.ndarray:
    sc = s["scale"]
    pts = [{"x": p["x"] * sc, "y": p["y"] * sc, "label": int(p["label"])} for p in body.get("points", [])]
    box = [v * sc for v in body["box"]] if body.get("box") else None
    if not pts and not box:
        raise HTTPException(400, "Provide points or a box")
    return _select(s["key"], s["small"], pts, box, s.setdefault("cache", {}))


@app.get("/api/info")
def info():
    return {"engine": engine.name, "max_side": MAX_SIDE, "video": video.available(), **models.status()}


# ------------------------------------------------------------------ image tools
def _make_session_route(tool: str):
    async def route(image: UploadFile = File(...), claims: dict = Depends(require(tool))):
        _gc()
        rgb = _decode(await image.read())
        small, scale = _work_copy(rgb)
        sid = uuid.uuid4().hex
        engine.set_image(sid, small)
        sessions[sid] = {"rgb": rgb, "small": small, "scale": scale, "alpha": None, "key": sid,
                         "tool": tool, "sub": claims.get("sub"), "t": time.time()}
        h, w = rgb.shape[:2]
        return {"session_id": sid, "width": w, "height": h, "tool": tool}
    return route


for _t in sorted(IMAGE_TOOLS):
    app.post(f"/v1/images/{_t}/session")(_make_session_route(_t))


@app.post("/v1/images/session/{sid}/segment")
def segment(sid: str, body: dict):
    """Live preview. remove -> matted RGBA cutout; erase -> the object mask to highlight."""
    s = _session(sid)
    if s["tool"] not in ("remove", "erase"):
        raise HTTPException(400, "This session has no selection step")
    s["clicks"] = s.get("clicks", 0) + 1
    if s["clicks"] > MAX_CLICKS:
        raise HTTPException(429, "Too many edits on this image. Upload it again to keep going.")
    m = _mask(s, body)
    if s["tool"] == "erase":
        s["mask"] = m
        full = cv2.resize(m, (s["rgb"].shape[1], s["rgb"].shape[0]), interpolation=cv2.INTER_NEAREST)
        return Response(_png(np.dstack([full, full, full, full]), "RGBA"), media_type="image/png")
    s["alpha"] = models.refine_with_matting(s["small"], m, guided_alpha)
    return Response(_png(compose_rgba(s["rgb"], s["alpha"]), "RGBA"), media_type="image/png")


@app.post("/v1/images/session/{sid}/export")
def export(sid: str, body: dict):
    s = _session(sid, "remove")
    if s["alpha"] is None:
        raise HTTPException(400, "Select a subject first")
    rgba = _flatten(compose_rgba(s["rgb"], s["alpha"]), body.get("background"))
    return Response(_png(rgba, "RGBA"), media_type="image/png",
                    headers={"Content-Disposition": 'attachment; filename="cutout.png"'})


@app.post("/v1/images/session/{sid}/erase")
def erase(sid: str, body: dict):
    """Inpaint the selected object; the result becomes the new base so you can erase again."""
    s = _session(sid, "erase")
    if s.get("erases", 0) >= MAX_ERASES:
        raise HTTPException(429, f"This image has used its {MAX_ERASES} erases. Upload it again to keep going.")
    s["erases"] = s.get("erases", 0) + 1
    m = _mask(s, body) if (body.get("points") or body.get("box")) else s.get("mask")
    if m is None:
        raise HTTPException(400, "Select what to erase first")
    sal = s.get("cache", {}).get("saliency")
    if sal is not None:
        near = cv2.dilate(m, np.ones((31, 31), np.uint8))
        m = np.where((near > 0) & (sal > 20), 255, m).astype(np.uint8)
    full = cv2.resize(m, (s["rgb"].shape[1], s["rgb"].shape[0]), interpolation=cv2.INTER_NEAREST)
    s["rgb"] = models.inpaint(s["rgb"], full)
    s["small"], s["scale"] = _work_copy(s["rgb"])
    s["mask"] = None
    s["cache"] = {}
    engine.set_image(s["key"], s["small"])
    buf = io.BytesIO()
    Image.fromarray(s["rgb"]).save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")


@app.post("/v1/images/session/{sid}/upscale")
def upscale(sid: str):
    s = _session(sid, "upscale")
    h, w = s["rgb"].shape[:2]
    if max(h, w) > 2048:
        raise HTTPException(400, "Upscale works on images up to 2048 px; this one is already large.")
    out, method = models.upscale2x(s["rgb"])
    return Response(_png(out, "RGB"), media_type="image/png", headers={"X-Upscale-Method": method})


@app.post("/v1/images/remove-background", dependencies=[Depends(require("remove"))])
async def remove_background(image: UploadFile = File(...), prompt: str = Form(...),
                            background: str | None = Form(None)):
    """One-shot API: image + prompt JSON ({points, box}) -> PNG."""
    try:
        p = json.loads(prompt)
    except json.JSONDecodeError:
        raise HTTPException(400, "prompt must be JSON")
    rgb = _decode(await image.read())
    small, scale = _work_copy(rgb)
    key = uuid.uuid4().hex
    engine.set_image(key, small)
    s = {"small": small, "scale": scale, "key": key}
    alpha = models.refine_with_matting(small, _mask(s, p), guided_alpha)
    return Response(_png(_flatten(compose_rgba(rgb, alpha), background), "RGBA"), media_type="image/png")


# ------------------------------------------------------------------ generation
@app.post("/v1/images/generate", dependencies=[Depends(require("generate"))])
def generate(body: dict):
    prompt = str(body.get("prompt", "")).strip()[:300]
    if len(prompt) < 3:
        raise HTTPException(400, "Write a longer prompt")
    try:
        img = models.generate(prompt, body.get("size", "square"), body.get("seed"))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    meta = {"ai_generated": "true", "prompt": prompt}
    return Response(_png(np.array(img), "RGB", meta), media_type="image/png",
                    headers={"X-AI-Generated": "true"})


# ------------------------------------------------------------------ video
@app.post("/v1/videos")
async def create_video(video_file: UploadFile = File(..., alias="video"), prompt: str = Form(...),
                       claims: dict = Depends(require("video"))):
    _gc()
    try:
        p = json.loads(prompt)
    except json.JSONDecodeError:
        raise HTTPException(400, "prompt must be JSON")
    suffix = Path(video_file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"}:
        suffix = ".mp4"
    fd, name = tempfile.mkstemp(suffix=suffix)
    tmp = Path(name)
    size, too_big = 0, False
    with os.fdopen(fd, "wb") as f:
        while chunk := await video_file.read(1 << 20):
            size += len(chunk)
            if size > MAX_VIDEO_BYTES:
                too_big = True
                break
            f.write(chunk)
    if too_big:
        tmp.unlink(missing_ok=True)
        raise HTTPException(413, "Video larger than 100 MB")
    try:
        return video.create(tmp, p, claims.get("lim", {}), claims.get("sub", ""))
    except video.VideoError as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, str(e))


@app.post("/v1/videos/{jid}/correct")
def correct_video(jid: str, body: dict):
    try:
        return video.correct(jid, body)
    except video.VideoError as e:
        raise HTTPException(400, str(e))


@app.get("/v1/jobs/{jid}")
def job_status(jid: str):
    j = video.jobs.get(jid)
    if not j:
        raise HTTPException(404, "Job not found or expired")
    return video.public(j)


@app.get("/v1/jobs/{jid}/frame/{i}")
def job_frame(jid: str, i: int):
    try:
        return Response(video.preview_frame(jid, i), media_type="image/jpeg")
    except video.VideoError as e:
        raise HTTPException(404, str(e))


@app.get("/v1/jobs/{jid}/result")
def job_result(jid: str, format: str = "webm", color: str = "#ffffff"):
    try:
        path = video.render_mp4(jid, color) if format == "mp4" else video.file_path(jid, "cutout.webm")
    except video.VideoError as e:
        raise HTTPException(400, str(e))
    return FileResponse(path, filename=f"cutout.{format}", media_type="video/mp4" if format == "mp4" else "video/webm")

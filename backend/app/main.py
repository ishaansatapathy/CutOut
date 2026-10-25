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

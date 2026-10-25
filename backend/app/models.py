"""Lazily loaded GPU models with CPU fallbacks. Each loader runs once; failures are remembered."""
import os
import re
import threading

import cv2
import numpy as np
from PIL import Image

from .config import DATA_DIR

_lock = threading.Lock()
_cache: dict[str, object] = {}
_errors: dict[str, str] = {}
gpu_lock = threading.Lock()


def _torch():
    import torch
    return torch


def device():
    try:
        return "cuda" if _torch().cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _load(name, fn):
    with _lock:
        if name in _cache:
            return _cache[name]
        if name in _errors:
            return None
        try:
            _cache[name] = fn()
            print(f"Loaded {name} on {device()}")
            return _cache[name]
        except Exception as e:
            _errors[name] = str(e)[:300]
            print(f"{name} unavailable: {e}")
            return None


def status():
    return {"device": device(), "loaded": sorted(_cache), "errors": _errors}


def warm():
    """Load models in the background at startup so the first user doesn't wait for them."""
    for name, fn in [("matting", _birefnet), ("inpaint", _lama), ("upscale", _swin2sr)]:
        _load(name, fn)
    if PROVIDER == "local" and os.getenv("WARM_GENERATE", "1") == "1":
        _load("generate", _generator)
        _load("safety", _safety)


# ---------------------------------------------------------------- matting
def _birefnet():
    from transformers import AutoModelForImageSegmentation
    torch = _torch()
    m = AutoModelForImageSegmentation.from_pretrained(
        os.getenv("MATTING_MODEL", "ZhengPeng7/BiRefNet_lite"), trust_remote_code=True)
    m.to(device()).eval()
    if device() == "cuda":
        m.half()
    return m


def matting_alpha(rgb: np.ndarray) -> np.ndarray | None:
    """Soft foreground alpha (uint8) from BiRefNet, or None when the model is unavailable."""
    m = _load("matting", _birefnet)
    if m is None:
        return None
    torch = _torch()
    h, w = rgb.shape[:2]
    x = cv2.resize(rgb, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    t = torch.from_numpy(x.transpose(2, 0, 1)).unsqueeze(0).to(device())
    t = t.half() if device() == "cuda" else t.float()
    with gpu_lock, torch.inference_mode():
        pred = m(t)[-1].sigmoid()[0, 0].float().cpu().numpy()
    return (cv2.resize(pred, (w, h), interpolation=cv2.INTER_LINEAR) * 255).astype(np.uint8)


def refine_with_matting(rgb, sam_mask, guided):
    """SAM decides *which* object; the matting model decides how soft its edge is."""
    soft = matting_alpha(rgb)
    if soft is None:
        return guided(rgb, sam_mask)
    k = max(5, int(max(rgb.shape[:2]) * 0.012)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    region = cv2.dilate(sam_mask, kernel, iterations=3)
    core = cv2.erode(sam_mask, kernel, iterations=2)
    out = np.where(region > 0, soft, 0)
    out = np.where(core > 0, np.maximum(out, 255), out).astype(np.uint8)
    if out.mean() < sam_mask.mean() * 0.4:
        return guided(rgb, sam_mask)
    return out


# ---------------------------------------------------------------- inpainting
LAMA_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"


def _lama():
    torch = _torch()
    path = DATA_DIR / "models" / "big-lama.pt"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.hub.download_url_to_file(LAMA_URL, str(path))
    m = torch.jit.load(str(path), map_location=device())
    m.eval()
    return m


LAMA_SIDE = 640


def _lama_run(m, img: np.ndarray, msk: np.ndarray) -> np.ndarray:
    torch = _torch()
    h, w = img.shape[:2]
    ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
    x = np.pad(img, ((0, ph), (0, pw), (0, 0)), mode="reflect").astype(np.float32) / 255
    k = np.pad(msk, ((0, ph), (0, pw)), mode="reflect")
    ti = torch.from_numpy(x.transpose(2, 0, 1))[None].to(device())
    tm = torch.from_numpy((k > 127).astype(np.float32))[None, None].to(device())
    with gpu_lock, torch.inference_mode():
        out = m(ti, tm)[0].permute(1, 2, 0).float().cpu().numpy()
    return np.clip(out * 255 if out.max() <= 1.5 else out, 0, 255).astype(np.uint8)[:h, :w]


def inpaint(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """LaMa works best near its training size, so inpaint a context crop at ~640 px and blend it back."""
    H, W = rgb.shape[:2]
    k = max(9, int(max(H, W) * 0.012)) | 1
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)), iterations=2)
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return rgb
    m = _load("inpaint", _lama)
    if m is None:
        return cv2.inpaint(rgb, mask, 7, cv2.INPAINT_TELEA)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    pad = int(max(bw, bh) * 0.6) + 32
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
    crop, cmask = rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    s = min(1.0, LAMA_SIDE / max(crop.shape[:2]))
    small = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else crop
    smask = cv2.resize(cmask, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST) if s < 1 else cmask
    fill = _lama_run(m, small, smask)
    if s < 1:
        fill = cv2.resize(fill, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_CUBIC)
    a = cv2.GaussianBlur(cmask.astype(np.float32) / 255, (0, 0), max(1.0, k / 4))[..., None]
    out = rgb.copy()
    out[y0:y1, x0:x1] = (crop * (1 - a) + fill * a).astype(np.uint8)
    return out


# ---------------------------------------------------------------- upscaling
def _swin2sr():
    from transformers import Swin2SRForImageSuperResolution
    m = Swin2SRForImageSuperResolution.from_pretrained(
        os.getenv("UPSCALE_MODEL", "caidas/swin2SR-classical-sr-x2-64"))
    return m.to(device()).eval()


def _sr_tile(m, tile: np.ndarray) -> np.ndarray:
    torch = _torch()
    h, w = tile.shape[:2]
    ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
    x = np.pad(tile, ((0, ph), (0, pw), (0, 0)), mode="reflect").astype(np.float32) / 255
    t = torch.from_numpy(x.transpose(2, 0, 1))[None].to(device())
    with torch.inference_mode():
        y = m(pixel_values=t).reconstruction[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()
    return (y[: h * 2, : w * 2] * 255).astype(np.uint8)


def upscale2x(rgb: np.ndarray) -> tuple[np.ndarray, str]:
    m = _load("upscale", _swin2sr)
    h, w = rgb.shape[:2]
    if m is None:
        up = cv2.resize(rgb, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)
        blur = cv2.GaussianBlur(up, (0, 0), 1.2)
        return cv2.addWeighted(up, 1.4, blur, -0.4, 0), "lanczos"
    T, O = 256, 16
    out = np.zeros((h * 2, w * 2, 3), np.uint8)
    with gpu_lock:
        for y in range(0, h, T):
            for x in range(0, w, T):
                y0, x0 = max(0, y - O), max(0, x - O)
                y1, x1 = min(h, y + T + O), min(w, x + T + O)
                sr = _sr_tile(m, rgb[y0:y1, x0:x1])
                cy, cx = (y - y0) * 2, (x - x0) * 2
                th, tw = min(T, h - y) * 2, min(T, w - x) * 2
                out[y * 2: y * 2 + th, x * 2: x * 2 + tw] = sr[cy: cy + th, cx: cx + tw]
    return out, "swin2sr"


# ---------------------------------------------------------------- generation
def _generator():
    torch = _torch()
    from diffusers import AutoPipelineForText2Image
    pipe = AutoPipelineForText2Image.from_pretrained(
        os.getenv("GEN_MODEL", "stabilityai/sd-turbo"),
        dtype=torch.float16 if device() == "cuda" else torch.float32,
        variant="fp16" if device() == "cuda" else None,
    )

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


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
    if device() == "cuda":
        pipe.enable_model_cpu_offload()
    return pipe


def _safety():
    from transformers import pipeline
    return pipeline("image-classification", model=os.getenv("SAFETY_MODEL", "Falconsai/nsfw_image_detection"),
                    device=0 if device() == "cuda" else -1)


BLOCKED = re.compile(
    r"\b(nude|nudity|naked|nsfw|porn\w*|sex|sexy|sexual|explicit|erotic\w*|lingerie|topless|hentai|loli\w*|undress\w*)\b",
    re.I,
)

PROVIDER = os.getenv("GEN_PROVIDER", "local")
SIZES = {"square": (1024, 1024), "portrait": (1024, 1536), "landscape": (1536, 1024)}


def _http_json(url: str, payload: dict, headers: dict, timeout=120) -> dict:
    import json
    import urllib.request
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _img_from_b64(b64: str) -> Image.Image:
    import base64
    import io
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _gen_openai(prompt: str, size: str) -> Image.Image:
    import urllib.error
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("Image generation is not configured on this server.")
    model = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
    dims = {"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}[size]
    try:
        j = _http_json("https://api.openai.com/v1/images/generations",
                       {"model": model, "prompt": prompt, "size": dims, "n": 1},
                       {"Authorization": f"Bearer {key}"})
    except urllib.error.HTTPError as e:
        raise ValueError("The image provider rejected that prompt.") if e.code in (400, 422) else RuntimeError("Image generation failed. Try again.")
    d = j["data"][0]
    if d.get("b64_json"):
        return _img_from_b64(d["b64_json"])
    import urllib.request
    with urllib.request.urlopen(d["url"], timeout=60) as r:
        import io
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def _gen_gemini(prompt: str) -> Image.Image:
    import urllib.error
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Image generation is not configured on this server.")
    model = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    try:
        j = _http_json(url, {"contents": [{"parts": [{"text": prompt}]}],
                             "generationConfig": {"responseModalities": ["IMAGE"]}}, {})
    except urllib.error.HTTPError as e:
        raise ValueError("The image provider rejected that prompt.") if e.code in (400, 422) else RuntimeError("Image generation failed. Try again.")
    for part in j.get("candidates", [{}])[0].get("content", {}).get("parts", []):
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return _img_from_b64(inline["data"])
    raise ValueError("The image provider returned no image for that prompt.")


def _gen_local(prompt: str, size: str, seed: int | None) -> Image.Image:
    pipe = _load("generate", _generator)
    if pipe is None:
        raise RuntimeError("Image generation is not available on this server.")
    torch = _torch()
    w, h = {"square": (512, 512), "portrait": (512, 768), "landscape": (768, 512)}[size]
    g = torch.Generator("cpu").manual_seed(seed if seed is not None else int.from_bytes(os.urandom(4), "little"))
    with gpu_lock, torch.inference_mode():
        img = pipe(prompt=prompt, width=w, height=h, num_inference_steps=2, guidance_scale=0.0, generator=g).images[0]
    safety = _load("safety", _safety)
    if safety is None:
        raise RuntimeError("Safety checker unavailable; generation disabled.")
    with gpu_lock:
        scores = {r["label"].lower(): r["score"] for r in safety(img)}
    if scores.get("nsfw", 0) > 0.4:
        raise ValueError("The result was flagged as unsafe and was not returned.")
    return img


def generate(prompt: str, size: str, seed: int | None) -> Image.Image:
    if BLOCKED.search(prompt):
        raise ValueError("This prompt isn't allowed.")
    if size not in SIZES:
        size = "square"
    if PROVIDER == "openai":
        return _gen_openai(prompt, size)
    if PROVIDER == "gemini":
        return _gen_gemini(prompt)
    return _gen_local(prompt, size, seed)

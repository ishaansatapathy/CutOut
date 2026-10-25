"""Segmentation: SAM 2 when available, OpenCV GrabCut fallback for dev."""
import os
import threading

import cv2
import numpy as np

SAM2_MODEL = os.getenv("SAM2_MODEL", "facebook/sam2.1-hiera-small")


class GrabCutEngine:
    name = "grabcut (fallback)"

    def set_image(self, _key, rgb):
        pass

    def predict(self, _key, rgb, points, box):
        h, w = rgb.shape[:2]
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
        r = max(6, int(min(h, w) * 0.03))
        if box:
            x0, y0, x1, y1 = [int(v) for v in box]
            mask[:] = cv2.GC_BGD
            mask[y0:y1, x0:x1] = cv2.GC_PR_FGD
        for p in points:
            x, y, lab = int(p["x"]), int(p["y"]), int(p["label"])
            if lab == 1:
                cv2.circle(mask, (x, y), r * 3, cv2.GC_PR_FGD, -1)
                cv2.circle(mask, (x, y), r, cv2.GC_FGD, -1)
            else:
                cv2.circle(mask, (x, y), r, cv2.GC_BGD, -1)
        bgd, fgd = np.zeros((1, 65)), np.zeros((1, 65))
        cv2.grabCut(bgr, mask, (0, 0, 1, 1), bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
        return np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)


class Sam2Engine:
    name = "SAM 2"

    def __init__(self):
        import torch
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        self.torch = torch
        self.predictor = SAM2ImagePredictor.from_pretrained(SAM2_MODEL, device="cuda" if torch.cuda.is_available() else "cpu")
        self.current = None
        self.lock = threading.Lock()

    def _ctx(self):
        t = self.torch
        return t.autocast("cuda", dtype=t.bfloat16) if t.cuda.is_available() else t.inference_mode()

    def set_image(self, key, rgb):
        with self.lock, self.torch.inference_mode(), self._ctx():
            self.predictor.set_image(rgb)
            self.current = key

    def candidates(self, key, rgb, points, box):
        with self.lock, self.torch.inference_mode(), self._ctx():
            if self.current != key:
                self.predictor.set_image(rgb)
                self.current = key
            coords = np.array([[p["x"], p["y"]] for p in points], np.float32) if points else None
            labels = np.array([p["label"] for p in points], np.int32) if points else None
            multi = coords is not None and len(coords) == 1 and box is None
            masks, scores, _ = self.predictor.predict(
                point_coords=coords, point_labels=labels,
                box=np.array(box, np.float32) if box else None,
                multimask_output=multi,
            )
            return masks > 0, scores

    def predict(self, key, rgb, points, box):
        masks, scores = self.candidates(key, rgb, points, box)
        return masks[pick_mask(masks, scores)].astype(np.uint8) * 255


def smart_select(masks, scores, saliency, point):
    """One positive click on the main subject should select all of it, not the face or a sleeve.
    The matting model's salient region is a second opinion: if the click lands on it, take the
    SAM candidate that best matches it (or the region itself). Clicks elsewhere keep SAM's pick."""
    fallback = masks[pick_mask(masks, scores)]
    if saliency is None:
        return fallback.astype(np.uint8) * 255
    fg = (saliency > 127).astype(np.uint8)
    _, lab = cv2.connectedComponents(fg)
    x = int(np.clip(point["x"], 0, fg.shape[1] - 1))
    y = int(np.clip(point["y"], 0, fg.shape[0] - 1))
    c = lab[y, x]
    if c == 0:
        return fallback.astype(np.uint8) * 255
    comp = lab == c
    ious = [(m & comp).sum() / max(1, (m | comp).sum()) for m in masks]
    i = int(np.argmax(ious))
    chosen = masks[i] if ious[i] >= 0.75 else comp
    return chosen.astype(np.uint8) * 255


def pick_mask(masks, scores):
    """A single click is ambiguous (part / sub-part / whole). Prefer the whole object among confident options."""
    if len(scores) == 1:
        return 0
    ok = scores >= scores.max() * 0.8
    areas = np.array([m.sum() for m in masks]) * ok
    return int(np.argmax(areas))


def load_engine():
    if os.getenv("USE_SAM2", "1") == "1":
        try:
            eng = Sam2Engine()
            print("Engine: SAM 2")
            return eng
        except Exception as e:
            print(f"SAM 2 unavailable ({e}); using GrabCut fallback")
    return GrabCutEngine()


def guided_alpha(rgb, mask, radius=8, eps=1e-3):
    """Edge-aware feathering of a hard mask using the image as guide (fast guided filter)."""
    I = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    p = mask.astype(np.float32) / 255
    k = (2 * radius + 1,) * 2
    mI, mp = cv2.blur(I, k), cv2.blur(p, k)
    cov = cv2.blur(I * p, k) - mI * mp
    var = cv2.blur(I * I, k) - mI * mI
    a = cov / (var + eps)
    b = mp - a * mI
    q = cv2.blur(a, k) * I + cv2.blur(b, k)
    return (np.clip(q, 0, 1) * 255).astype(np.uint8)


def compose_rgba(original_rgb, alpha_small):
    h, w = original_rgb.shape[:2]
    alpha = cv2.resize(alpha_small, (w, h), interpolation=cv2.INTER_CUBIC)
    return np.dstack([original_rgb, alpha])

"""One-time job tokens minted by the web server after ads, credits or API billing clear."""
import base64
import hashlib
import hmac
import json
import threading
import time

from fastapi import Header, HTTPException

from .config import JOB_SECRET

_used: dict[str, float] = {}
_lock = threading.Lock()


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify(token: str | None, tool: str) -> dict:
    if not JOB_SECRET:
        raise HTTPException(500, "JOB_SECRET is not configured")
    if not token or "." not in token:
        raise HTTPException(401, "Missing job token")
    body, sig = token.rsplit(".", 1)
    good = hmac.new(JOB_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(good, sig):
        raise HTTPException(401, "Invalid job token")
    claims = json.loads(_b64d(body))
    now = time.time()
    if claims.get("exp", 0) < now:
        raise HTTPException(401, "Job token expired")
    if claims.get("tool") != tool:
        raise HTTPException(403, f"Token is not valid for {tool}")
    with _lock:
        for k in [k for k, t in _used.items() if t < now]:
            del _used[k]
        if claims["jti"] in _used:
            raise HTTPException(409, "Job token already used")
        _used[claims["jti"]] = claims["exp"]
    return claims


def require(tool: str):
    def dep(x_job_token: str | None = Header(default=None)):
        return verify(x_job_token, tool)
    return dep

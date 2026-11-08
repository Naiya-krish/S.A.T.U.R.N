"""In-process rate limiting.

A token bucket per key (user id, or client IP when anonymous). The buckets are
deliberately simple and process-local: one backend instance is the deployment
target, and a distributed limiter would need Redis that this project does not
have. If you scale horizontally, move this to a shared store - the interface is
the same.

Headers returned on every limited route so clients can back off honestly:
  X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After (on 429).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Tuple

from fastapi import HTTPException, Request

from .config import get_settings


@dataclass
class Bucket:
    tokens: float
    updated: float


_BUCKETS: Dict[str, Bucket] = {}
_MAX_KEYS = 10_000


def _refill(bucket: Bucket, now: float, rate_per_s: float, burst: float) -> Bucket:
    elapsed = max(0.0, now - bucket.updated)
    bucket.tokens = min(burst, bucket.tokens + elapsed * rate_per_s)
    bucket.updated = now
    return bucket


def client_key(request: Request, uid: str | None = None) -> str:
    if uid:
        return f"u:{uid}"
    # Prefer the real client address set by the platform proxy.
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
    return f"ip:{ip}"


def check(request: Request, uid: str | None = None, cost: float = 1.0) -> Tuple[float, float]:
    """Consume `cost` tokens. Returns (limit, remaining). Raises 429."""
    settings = get_settings()
    limit = float(settings.rate_limit_per_minute)
    burst = float(settings.rate_limit_burst)
    rate_per_s = limit / 60.0

    key = client_key(request, uid)
    now = time.time()

    if len(_BUCKETS) > _MAX_KEYS:
        # Evict the least recently touched half; this is a safety valve only.
        for k in sorted(_BUCKETS, key=lambda k: _BUCKETS[k].updated)[: _MAX_KEYS // 2]:
            _BUCKETS.pop(k, None)

    bucket = _refill(_BUCKETS.get(key, Bucket(tokens=burst, updated=now)), now, rate_per_s, burst)

    if bucket.tokens < cost:
        retry_after = max(1, int((cost - bucket.tokens) / rate_per_s))
        _BUCKETS[key] = bucket
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit exceeded ({int(limit)} requests/minute). "
                f"Retry in {retry_after}s."
            ),
            headers={"Retry-After": str(retry_after), "X-RateLimit-Limit": str(int(limit))},
        )

    bucket.tokens -= cost
    _BUCKETS[key] = bucket
    return limit, bucket.tokens


def reset() -> None:
    """Test helper."""
    _BUCKETS.clear()

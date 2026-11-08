"""Shared httpx AsyncClient with headers and graceful errors."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional

import httpx

from .config import get_settings

log = logging.getLogger("saturn.http")

_client: Optional[httpx.AsyncClient] = None
_lock = asyncio.Lock()


class UpstreamError(RuntimeError):
    """A provider failed in a way we must report honestly to the user."""

    def __init__(self, provider: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.provider = provider
        self.message = message
        self.status_code = status_code


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        async with _lock:
            if _client is None:
                _client = httpx.AsyncClient(
                    timeout=httpx.Timeout(20.0, connect=10.0),
                    follow_redirects=True,
                    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


class TTLCache:
    """Tiny in-process TTL cache (provider responses are read-only)."""

    def __init__(self, ttl_s: float = 300.0, max_items: int = 512):
        self.ttl_s = ttl_s
        self.max_items = max_items
        self._data: Dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        item = self._data.get(key)
        if not item:
            return None
        ts, value = item
        if time.monotonic() - ts > self.ttl_s:
            self._data.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        if len(self._data) >= self.max_items:
            oldest = min(self._data, key=lambda k: self._data[k][0])
            self._data.pop(oldest, None)
        self._data[key] = (time.monotonic(), value)

    def clear(self) -> None:
        self._data.clear()


async def request_json(
    provider: str,
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout_s: float = 20.0,
) -> Any:
    client = await get_client()
    try:
        resp = await client.request(method, url, headers=headers, params=params, timeout=timeout_s)
    except httpx.TimeoutException as exc:
        raise UpstreamError(provider, f"{provider} did not respond within {timeout_s:.0f}s.") from exc
    except httpx.HTTPError as exc:
        raise UpstreamError(provider, f"{provider} network error: {exc.__class__.__name__}.") from exc
    if resp.status_code >= 400:
        raise UpstreamError(
            provider,
            f"{provider} returned HTTP {resp.status_code}.",
            status_code=resp.status_code,
        )
    try:
        return resp.json()
    except ValueError as exc:
        raise UpstreamError(provider, f"{provider} returned a non-JSON response.") from exc


async def request_text(
    provider: str,
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout_s: float = 25.0,
) -> str:
    client = await get_client()
    try:
        resp = await client.request(method, url, headers=headers, params=params, timeout=timeout_s)
    except httpx.TimeoutException as exc:
        raise UpstreamError(provider, f"{provider} did not respond within {timeout_s:.0f}s.") from exc
    except httpx.HTTPError as exc:
        raise UpstreamError(provider, f"{provider} network error: {exc.__class__.__name__}.") from exc
    if resp.status_code >= 400:
        raise UpstreamError(provider, f"{provider} returned HTTP {resp.status_code}.", status_code=resp.status_code)
    return resp.text

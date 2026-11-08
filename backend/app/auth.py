"""Firebase ID token verification and per-user identity.

Design notes
------------
* Tri-state, never a lie. ``auth_mode`` is one of:
    - ``firebase`` - a project is configured and tokens are verified for real
    - ``demo``     - no Firebase project; the app runs as a safe public demo
    - ``disabled`` - explicitly turned off (``SATURN_AUTH=disabled``)
  Protected routes behave differently per mode and always say which mode is
  active in their responses, so nothing pretends to be authenticated when it is
  not.

* Tokens are verified server-side only. The browser never holds a service
  account, and no secret is ever returned to it.

* When ``firebase`` is configured we use the official Admin SDK, which downloads
  Google's public keys and checks issuer/audience/expiry. If the SDK or the
  credentials are missing we fail CLOSED (401) rather than trusting the token.

* Verification results are cached briefly (by token hash) so a burst of polling
  requests does not re-verify the same token dozens of times.
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException

from .config import get_settings

log = logging.getLogger("saturn.auth")


@dataclass
class Identity:
    """The authenticated caller."""

    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    mode: str = "firebase"  # firebase | demo

    @property
    def is_demo(self) -> bool:
        return self.mode == "demo"


class AuthError(HTTPException):
    def __init__(self, detail: str, status_code: int = 401) -> None:
        super().__init__(status_code=status_code, detail=detail)


# token-hash -> (Identity, expires_at)
_CACHE: Dict[str, tuple[Identity, float]] = {}
_CACHE_TTL_S = 300.0
_CACHE_MAX = 256


def auth_mode() -> str:
    """Which auth mode the backend is in. Reported to the UI, never guessed."""
    settings = get_settings()
    explicit = (settings.saturn_auth or "").strip().lower()
    if explicit == "disabled":
        return "disabled"
    if settings.google_cloud_project and settings.firebase_enabled:
        return "firebase"
    return "demo"


def _cache_get(key: str) -> Optional[Identity]:
    hit = _CACHE.get(key)
    if not hit:
        return None
    ident, exp = hit
    if exp < time.time():
        _CACHE.pop(key, None)
        return None
    return ident


def _cache_put(key: str, ident: Identity) -> None:
    if len(_CACHE) >= _CACHE_MAX:
        # Drop the oldest entries wholesale; this cache only saves CPU.
        for k in list(_CACHE)[: _CACHE_MAX // 2]:
            _CACHE.pop(k, None)
    _CACHE[key] = (ident, time.time() + _CACHE_TTL_S)


def _verify_with_admin_sdk(token: str) -> Identity:
    """Verify with firebase-admin. Fails closed if it is not usable."""
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import auth as fb_auth  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on install
        raise AuthError(
            "Firebase Admin SDK is not installed; refusing to accept unverified tokens."
        ) from exc

    settings = get_settings()
    try:
        if not firebase_admin._apps:  # noqa: SLF001 - documented way to check init
            firebase_admin.initialize_app(options={"projectId": settings.google_cloud_project})
        decoded: Dict[str, Any] = fb_auth.verify_id_token(token, check_revoked=False)
    except Exception as exc:  # noqa: BLE001 - any failure means "not authenticated"
        log.info("firebase.token_rejected", extra={"reason": type(exc).__name__})
        raise AuthError("Invalid or expired authentication token.") from exc

    uid = decoded.get("uid") or decoded.get("sub")
    if not uid:
        raise AuthError("Token did not contain a user id.")
    return Identity(uid=str(uid), email=decoded.get("email"), name=decoded.get("name"))


def verify_bearer(authorization: Optional[str]) -> Identity:
    """Resolve the caller from an Authorization header."""
    mode = auth_mode()

    if mode == "disabled":
        raise AuthError("Authentication is disabled on this deployment.", 503)

    token: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

    if mode == "demo":
        # Public demo: no accounts, one shared sandbox identity. Never claims to
        # be a real user, and per-user data is namespaced under a demo path.
        if token:
            raise AuthError(
                "This deployment runs in DEMO mode and does not accept accounts. "
                "Saved data is not private."
            )
        return Identity(uid="demo", mode="demo")

    if not token:
        raise AuthError("Missing bearer token.")

    key = hashlib.sha256(token.encode()).hexdigest()
    cached = _cache_get(key)
    if cached:
        return cached

    ident = _verify_with_admin_sdk(token)
    _cache_put(key, ident)
    return ident


async def current_identity(authorization: Optional[str] = Header(default=None)) -> Identity:
    """FastAPI dependency for protected routes."""
    return verify_bearer(authorization)


async def optional_identity(authorization: Optional[str] = Header(default=None)) -> Optional[Identity]:
    """For routes that enhance behaviour when signed in but work anonymously."""
    try:
        return verify_bearer(authorization)
    except (AuthError, HTTPException):
        return None


def reset_cache() -> None:
    """Test helper: drop cached identities."""
    _CACHE.clear()

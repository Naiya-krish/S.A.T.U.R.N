"""Saved investigations, views and preferences (Phase 8).

Storage contract
----------------
Every document lives under a per-user path::

    {prefix}/users/{uid}/regions/{region_id}
    {prefix}/users/{uid}/views/{view_id}
    {prefix}/users/{uid}/prefs/{pref_id}

Isolation is therefore structural: there is no code path that can read another
user's collection without knowing their uid, and the uid always comes from a
verified token (see :mod:`app.auth`), never from the request body.

Modes
-----
* ``firestore`` - a project is configured and the Admin SDK is available.
* ``local``     - no Firebase project. Documents are kept in a process-local
  dict so the feature is fully exercisable in development. This is recorded in
  every response (``storage: "local"``) so the UI can label saved data honestly.
"""

from __future__ import annotations

import copy
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .config import get_settings

log = logging.getLogger("saturn.store")

Kind = Literal["regions", "views", "prefs"]


# ───────────────────────────── models ─────────────────────────────
class BoundsModel(BaseModel):
    south: float
    west: float
    north: float
    east: float


class SavedRegion(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    lat: float
    lon: float
    bounds: Optional[BoundsModel] = None
    layer_id: Optional[str] = None
    observation_date: Optional[str] = None
    note: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class SavedView(BaseModel):
    """A camera pose the operator can return to."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    lat: float
    lon: float
    altitude_km: float = 16200
    overlays: Dict[str, bool] = Field(default_factory=dict)
    created_at: float = Field(default_factory=time.time)


class Preferences(BaseModel):
    id: str = "prefs"
    overlays: Dict[str, bool] = Field(default_factory=dict)
    opacity: float = 0.92
    voice_muted: bool = False
    voice_volume: float = 0.9
    updated_at: float = Field(default_factory=time.time)


# ───────────────────────────── backend ─────────────────────────────
@dataclass
class _LocalDB:
    users: Dict[str, Dict[str, Dict[str, Any]]] = field(default_factory=dict)


_LOCAL = _LocalDB()


def storage_mode() -> str:
    settings = get_settings()
    if not settings.google_cloud_project:
        return "local"
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import firestore  # type: ignore  # noqa: F401
    except ImportError:
        return "local"
    return "firestore"


def _collection(uid: str, kind: Kind):
    """Return the Firestore collection for a user (or None in local mode)."""
    if storage_mode() != "firestore":
        return None
    import firebase_admin  # type: ignore
    from firebase_admin import firestore  # type: ignore

    settings = get_settings()
    if not firebase_admin._apps:  # noqa: SLF001
        firebase_admin.initialize_app(options={"projectId": settings.google_cloud_project})
    db = firestore.client()
    return db.collection(f"{settings.firestore_prefix}/users/{uid}/{kind}")


def _local_bucket(uid: str, kind: Kind) -> Dict[str, Any]:
    user = _LOCAL.users.setdefault(uid, {})
    return user.setdefault(kind, {})


# ───────────────────────────── CRUD ─────────────────────────────
def list_documents(uid: str, kind: Kind) -> List[Dict[str, Any]]:
    coll = _collection(uid, kind)
    if coll is None:
        return [copy.deepcopy(v) for v in _local_bucket(uid, kind).values()]
    out: List[Dict[str, Any]] = []
    for doc in coll.stream():
        data = doc.to_dict() or {}
        data.setdefault("id", doc.id)
        out.append(data)
    out.sort(key=lambda d: d.get("created_at", 0), reverse=True)
    return out


def get_document(uid: str, kind: Kind, doc_id: str) -> Optional[Dict[str, Any]]:
    coll = _collection(uid, kind)
    if coll is None:
        got = _local_bucket(uid, kind).get(doc_id)
        return copy.deepcopy(got) if got else None
    snap = coll.document(doc_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    data.setdefault("id", doc_id)
    return data


def put_document(uid: str, kind: Kind, payload: BaseModel) -> Dict[str, Any]:
    data = asdict(payload) if hasattr(payload, "__dataclass_fields__") else payload.model_dump()
    doc_id = str(data.get("id") or uuid.uuid4().hex[:12])
    data["id"] = doc_id
    data["updated_at"] = time.time()
    data.setdefault("created_at", data["updated_at"])

    coll = _collection(uid, kind)
    if coll is None:
        _local_bucket(uid, kind)[doc_id] = copy.deepcopy(data)
        return data
    coll.document(doc_id).set(data, merge=True)
    return data


def delete_document(uid: str, kind: Kind, doc_id: str) -> bool:
    coll = _collection(uid, kind)
    if coll is None:
        return _local_bucket(uid, kind).pop(doc_id, None) is not None
    ref = coll.document(doc_id)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


def clear_user(uid: str) -> int:
    """Delete every saved document for one user. Used by tests and by DELETE /me."""
    total = 0
    for kind in ("regions", "views", "prefs"):
        coll = _collection(uid, kind)
        if coll is None:
            total += len(_local_bucket(uid, kind))
            _local_bucket(uid, kind).clear()
            continue
        for doc in list(coll.stream()):
            doc.reference.delete()
            total += 1
    return total


def reset_local() -> None:
    """Test helper."""
    _LOCAL.users.clear()

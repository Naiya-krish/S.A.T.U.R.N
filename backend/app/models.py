"""Pydantic models shared across the API.

Provenance is first-class: anything that comes from a provider carries
provider / product / observation time / retrieval time / freshness.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Freshness(str, Enum):
    RECENT_OBSERVATION = "RECENT_OBSERVATION"
    HISTORICAL = "HISTORICAL"
    FORECAST = "FORECAST"
    STALE = "STALE"
    UNAVAILABLE = "UNAVAILABLE"


class Provenance(BaseModel):
    provider: str
    product: str
    observation_time: Optional[str] = None
    retrieval_time: str = Field(default_factory=lambda: utcnow().isoformat())
    freshness: Freshness = Freshness.UNAVAILABLE
    attribution: Optional[str] = None
    source_url: Optional[str] = None
    note: Optional[str] = None


# ───────────────────────────── locations ─────────────────────────────
class LocationCandidate(BaseModel):
    id: str
    name: str
    display_name: str
    type: str
    category: Optional[str] = None
    country: Optional[str] = None
    country_code: Optional[str] = None
    lat: float
    lon: float
    bbox: List[float]  # south, west, north, east
    importance: float = 0.0
    score: float = 0.0
    kind: Literal["location", "coordinate"] = "location"


class Boundary(BaseModel):
    """GeoJSON geometry plus a short honesty note about its origin."""

    type: Literal["Polygon", "MultiPolygon"] = "Polygon"
    coordinates: Any
    is_exact: bool = False
    note: str = "Approximate outline derived from the provider bounding box."


class ResolveResponse(BaseModel):
    query: str
    status: Literal["resolved", "ambiguous", "not_found", "invalid"]
    needs_clarification: bool = False
    best: Optional[LocationCandidate] = None
    candidates: List[LocationCandidate] = Field(default_factory=list)
    boundary: Optional[Boundary] = None
    context: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    provenance: Provenance


class ContextResponse(BaseModel):
    name: str
    lat: float
    lon: float
    bbox: List[float]
    area_km2: Optional[float] = None
    span_deg: List[float] = Field(default_factory=list)
    continent: Optional[str] = None
    descriptions: List[str] = Field(default_factory=list)
    country: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    provenance: Provenance


# ───────────────────────────── imagery ──────────────────────────────
class LayerInfo(BaseModel):
    id: str
    title: str
    format: str
    projection: str
    tile_matrix_set: str
    temporal_start: Optional[str] = None
    temporal_end: Optional[str] = None
    temporal_period: Optional[str] = "P1D"
    attribution: str = "NASA Global Imagery Browse Services (GIBS)"
    supported: bool = True


class LayerListResponse(BaseModel):
    layers: List[LayerInfo]
    provenance: Provenance


class ObservationDate(BaseModel):
    date: str
    available: bool
    reason: Optional[str] = None


class ImageryTilePlan(BaseModel):
    provider: str = "NASA GIBS"
    layer_id: str
    title: str
    date: str
    projection: str
    tile_matrix_set: str
    tile_template: str
    format: str
    max_zoom: int
    attribution: str
    provenance: Provenance
    warnings: List[str] = Field(default_factory=list)


# ───────────────────────────── events / fires ───────────────────────
class EventGeometry(BaseModel):
    type: str
    coordinates: Any


class EarthEvent(BaseModel):
    id: str
    category: str
    title: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    geometry: Optional[EventGeometry] = None
    time: Optional[str] = None
    closed: Optional[str] = None
    status: str = "open"
    source_link: Optional[str] = None
    sources: List[Dict[str, Any]] = Field(default_factory=list)
    provenance: Optional[Provenance] = None


class FireDetection(BaseModel):
    """A satellite thermal ANOMALY - not a confirmed wildfire."""

    id: str
    lat: float
    lon: float
    brightness_k: Optional[float] = None
    confidence: Optional[str] = None
    frp_mw: Optional[float] = None
    satellite: Optional[str] = None
    instrument: Optional[str] = None
    acquisition_time: Optional[str] = None
    daynight: Optional[str] = None
    label: str = "Thermal anomaly detection (not a confirmed wildfire)"


class FireResponse(BaseModel):
    detections: List[FireDetection]
    count: int
    window: Dict[str, Any]
    provenance: Provenance
    warnings: List[str] = Field(default_factory=list)


# ───────────────────────── UI action registry ───────────────────────
class UIActionStatus(str, Enum):
    ACCEPTED = "accepted"
    EXECUTED = "executed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class UIAction(BaseModel):
    action_id: str
    type: str
    args: Dict[str, Any] = Field(default_factory=dict)
    status: UIActionStatus = UIActionStatus.ACCEPTED
    origin: Literal["agent", "human", "debug"] = "agent"


class UIActionAck(BaseModel):
    action_id: str
    status: UIActionStatus
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskEvent(BaseModel):
    seq: int
    kind: Literal["status", "ui_action", "tool", "message", "error", "result"]
    task_id: str
    ts: str = Field(default_factory=lambda: utcnow().isoformat())
    data: Dict[str, Any] = Field(default_factory=dict)


class AgentCommandRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    session_id: Optional[str] = None
    mode: Literal["text", "voice"] = "text"
    # Compact UI snapshot sent by the browser (camera, active layer, overlays ...).
    ui_state: Dict[str, Any] = Field(default_factory=dict)


class AgentCommandResponse(BaseModel):
    task_id: str
    status: TaskStatus
    mode: str

"""NASA EONET v3 - natural event adapter (no key required)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from ..geo.coords import BBox
from ..http_client import TTLCache, request_json
from ..models import EarthEvent, EventGeometry, Freshness, Provenance, utcnow

EONET_ROOT = "https://eonet.gsfc.nasa.gov/api/v3"


def _provenance() -> Provenance:
    return Provenance(
        provider="NASA EONET",
        product="Earth Observatory Natural Event Tracker v3",
        retrieval_time=utcnow().isoformat(),
        freshness=Freshness.RECENT_OBSERVATION,
        attribution="NASA EONET - https://eonet.gsfc.nasa.gov/",
        source_url="https://eonet.gsfc.nasa.gov/",
        note="Event positions come from the reporting agency; some carry a time lag.",
    )


def _centroid(geom: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    try:
        if gtype == "Point":
            return float(coords[1]), float(coords[0])
        if gtype in ("Polygon", "MultiPolygon"):
            ring = coords[0] if gtype == "Polygon" else coords[0][0]
            lats = [p[1] for p in ring]
            lons = [p[0] for p in ring]
            return sum(lats) / len(lats), sum(lons) / len(lons)
        if gtype == "LineString":
            lats = [p[1] for p in coords]
            lons = [p[0] for p in coords]
            return sum(lats) / len(lats), sum(lons) / len(lons)
    except (TypeError, IndexError, ZeroDivisionError):
        return None, None
    return None, None


def normalize_event(raw: Dict[str, Any]) -> Optional[EarthEvent]:
    geoms = raw.get("geometry") or []
    if not geoms:
        return None
    latest = sorted(geoms, key=lambda g: g.get("date") or "")[-1]
    geom = latest.get("geometry") or {}
    lat, lon = _centroid(geom)
    cats = raw.get("categories") or []
    cat = cats[0].get("title") if cats else "Unknown"
    sources = raw.get("sources") or []
    return EarthEvent(
        id=raw.get("id") or "unknown",
        category=cat,
        title=raw.get("title") or "Untitled event",
        lat=lat,
        lon=lon,
        geometry=EventGeometry(type=geom.get("type", "Point"), coordinates=geom.get("coordinates")),
        time=latest.get("date"),
        closed=raw.get("closed"),
        status="closed" if raw.get("closed") else "open",
        source_link=sources[0].get("url") if sources else None,
        sources=sources,
        provenance=_provenance(),
    )


class EONETClient:
    def __init__(self) -> None:
        self._cache = TTLCache(ttl_s=900, max_items=64)

    async def list_events(
        self,
        *,
        status: str = "open",
        days: int = 30,
        bbox: Optional[BBox] = None,
        category: Optional[str] = None,
        limit: int = 60,
    ) -> List[EarthEvent]:
        params: Dict[str, Any] = {"status": status, "days": max(1, min(365, days)), "limit": 200}
        if bbox is not None:
            params["bbox"] = ",".join(f"{v:.3f}" for v in bbox.to_list())
        if category:
            params["category"] = category
        key = str(sorted(params.items()))
        cached = self._cache.get(key)
        if cached is None:
            data = await request_json("NASA EONET", "GET", f"{EONET_ROOT}/events", params=params)
            self._cache.set(key, data)
        else:
            data = cached
        events_raw = (data or {}).get("events") or []
        out: List[EarthEvent] = []
        for raw in events_raw:
            ev = normalize_event(raw)
            if ev is not None:
                out.append(ev)
        return out[:limit]

    async def categories(self) -> List[Dict[str, Any]]:
        data = await request_json("NASA EONET", "GET", f"{EONET_ROOT}/categories")
        return (data or {}).get("categories") or []


eonet = EONETClient()


def filter_visible(events: List[EarthEvent], bbox: BBox) -> List[EarthEvent]:
    def inside(lat: float, lon: float) -> bool:
        if not (bbox.south <= lat <= bbox.north):
            return False
        if bbox.crosses_antimeridian:
            return lon >= bbox.west or lon <= bbox.east
        return bbox.west <= lon <= bbox.east

    return [e for e in events if e.lat is not None and e.lon is not None and inside(e.lat, e.lon)]




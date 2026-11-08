"""NASA FIRMS - near-real-time thermal anomaly detections.

Needs a MAP_KEY (FIRMS_MAP_KEY env var). Every detection is labelled a thermal
anomaly, not a confirmed wildfire, and carries satellite, confidence and
acquisition time. Only the visible bounding box and time window are queried.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Optional

from ..config import get_settings
from ..geo.coords import BBox
from ..http_client import TTLCache, UpstreamError, request_text
from ..models import FireDetection, FireResponse, Freshness, Provenance, utcnow

FIRMS_AREA_CSV = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
DEFAULT_SOURCE = "VIIRS_SNPP_NRT"
SUPPORTED_SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT", "VIIRS_SNPP_SP"]


class FIRMSClient:
    def __init__(self) -> None:
        self._cache = TTLCache(ttl_s=600, max_items=64)

    @property
    def map_key(self) -> str:
        return get_settings().firms_map_key

    @property
    def configured(self) -> bool:
        return bool(self.map_key)

    async def fetch(
        self,
        bbox: BBox,
        *,
        source: str = DEFAULT_SOURCE,
        days: int = 1,
        max_rows: int = 500,
    ) -> FireResponse:
        now = utcnow()
        retrieval = now.isoformat()
        prov = Provenance(
            provider="NASA FIRMS",
            product=f"{source} thermal anomalies",
            retrieval_time=retrieval,
            freshness=Freshness.RECENT_OBSERVATION,
            attribution="NASA FIRMS - Fire Information for Resource Management System",
            source_url="https://firms.modaps.eosdis.nasa.gov/",
            note="Detections are satellite thermal anomalies; they are NOT confirmed wildfires.",
        )
        if not self.configured:
            return FireResponse(
                detections=[],
                count=0,
                window={"bbox": bbox.to_list(), "days": days, "source": source},
                provenance=prov.model_copy(
                    update={"freshness": Freshness.UNAVAILABLE, "note": "NASA FIRMS MAP_KEY is not configured on the server."}
                ),
                warnings=["NASA FIRMS is not configured (FIRMS_MAP_KEY missing). No fire detections were retrieved."],
            )
        if source not in SUPPORTED_SOURCES:
            raise UpstreamError("NASA FIRMS", f"Unsupported FIRMS source '{source}'. Use one of {SUPPORTED_SOURCES}.", 400)
        area = f"{bbox.west:.3f},{bbox.south:.3f},{bbox.east:.3f},{bbox.north:.3f}"
        day_range = max(1, min(10, days))
        url = f"{FIRMS_AREA_CSV}/{self.map_key}/{source}/{area}/{day_range}"
        cached = self._cache.get(url)
        if cached is None:
            text = await request_text("NASA FIRMS", "GET", url, timeout_s=40.0)
            if text.lstrip().startswith("<") or "Invalid" in text[:200]:
                raise UpstreamError("NASA FIRMS", "FIRMS rejected the request (check MAP_KEY and area).")
            self._cache.set(url, text)
            cached = text
        text = cached

        warnings: List[str] = []
        rows = list(csv.DictReader(io.StringIO(text)))
        detections: List[FireDetection] = []
        for i, row in enumerate(rows[:max_rows]):
            try:
                lat = float(row.get("latitude") or "")
                lon = float(row.get("longitude") or "")
            except ValueError:
                continue
            acq_date = row.get("acq_date") or ""
            acq_time = (row.get("acq_time") or "").zfill(4)
            acq = f"{acq_date}T{acq_time[:2]}:{acq_time[2:4]}:00Z" if acq_date else None
            detections.append(
                FireDetection(
                    id=row.get("frp_reference") or f"{row.get('satellite','sat')}-{acq_date}-{lat:.3f}-{lon:.3f}-{i}",
                    lat=lat,
                    lon=lon,
                    brightness_k=_f(row.get("bright_ti4") or row.get("brightness")),
                    confidence=row.get("confidence") or None,
                    frp_mw=_f(row.get("frp")),
                    satellite=row.get("satellite") or None,
                    instrument=row.get("instrument") or None,
                    acquisition_time=acq,
                    daynight=row.get("daynight") or None,
                )
            )
        if len(rows) >= max_rows and max_rows > 0:
            warnings.append(f"Result truncated to {max_rows} of {len(rows)} detections available in the window.")
        if not detections:
            warnings.append("No thermal anomalies were detected in this bounding box and time window.")
        return FireResponse(
            detections=detections,
            count=len(detections),
            window={"bbox": bbox.to_list(), "days": day_range, "source": source},
            provenance=prov,
            warnings=warnings,
        )


def _f(v: Optional[str]) -> Optional[float]:
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


firms = FIRMSClient()

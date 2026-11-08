"""NASA GIBS (Global Imagery Browse Services) - WMTS adapter.

We parse the public GetCapabilities document, only expose layers we have
verified, build WMTS REST tile template URLs, and never claim imagery is live:
each layer carries the observation / composite period and its freshness class.

Tile URL format (RESTful WMTS, GoogleMapsCompatible matrix):
  https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{LAYER}/default/{TIME}/{TMS}/{z}/{y}/{x}.{ext}
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

from ..http_client import TTLCache, UpstreamError, request_text
from ..models import Freshness, ImageryTilePlan, LayerInfo, ObservationDate, Provenance, utcnow

WMTS_ROOT = "https://gibs.earthdata.nasa.gov/wmts"
ACK = (
    "Imagery courtesy NASA Global Imagery Browse Services (GIBS) / NASA EOSDIS. "
    "We acknowledge the use of imagery provided by services from NASA's GIBS."
)

# Verified layers only. Each has been chosen for global daily coverage.
VERIFIED_LAYERS: Dict[str, Dict[str, str]] = {
    "MODIS_Terra_CorrectedReflectance_TrueColor": {
        "title": "MODIS Terra Corrected Reflectance (True Colour), daily composite",
        "kind": "truecolor",
    },
    "MODIS_Terra_CorrectedReflectance_Bands721": {
        "title": "MODIS Terra Corrected Reflectance (Bands 7-2-1), daily composite",
        "kind": "falsecolor",
    },
    "VIIRS_SNPP_CorrectedReflectance_TrueColor": {
        "title": "VIIRS SNPP Corrected Reflectance (True Colour), daily composite",
        "kind": "truecolor",
    },
    "VIIRS_NOAA20_CorrectedReflectance_TrueColor": {
        "title": "VIIRS NOAA-20 Corrected Reflectance (True Colour), daily composite",
        "kind": "truecolor",
    },
    "MODIS_Terra_Cloud_Fraction_Day": {
        "title": "MODIS Terra Cloud Fraction (Day)",
        "kind": "science",
    },
}

# Documented coverage start for the daily global composites used above.
DEFAULT_START = date(2000, 2, 24)
# GIBS adds a layer for "today" only after ingestion; one day lag is the norm.
INGEST_LAG_DAYS = 1

_LAYER_TITLE_RE = re.compile(r"<ows:Identifier>([^<]+)</ows:Identifier>(.*?)</Layer>", re.S)
_TITLE_RE = re.compile(r"<ows:Title>([^<]+)</ows:Title>")
_FORMAT_RE = re.compile(r"<Format>([^<]+)</Format>")
_TMS_RE = re.compile(r"<TileMatrixSet>([^<]+)</TileMatrixSet>")
_PERIOD_RE = re.compile(r"<ows:TimePeriod>(.*?)</ows:TimePeriod>", re.S)
_INTERVAL_RE = re.compile(r"(?:start|beginPosition)>([^<]+)<.*?(?:end|endPosition)>([^<]+)<", re.S)
_DURATION_RE = re.compile(r"<(?:ows:)?Duration>([^<]+)<")


class GIBSClient:
    def __init__(self) -> None:
        self._caps_cache = TTLCache(ttl_s=6 * 3600, max_items=4)
        self._layers_cache: Optional[Dict[str, LayerInfo]] = None

    # ─────────────────────────── capabilities ───────────────────────────
    def capabilities_url(self, projection: str) -> str:
        return f"{WMTS_ROOT}/{projection.lower()}/best/1.0.0/WMTSCapabilities.xml"

    async def fetch_capabilities(self, projection: str = "EPSG3857") -> str:
        cached = self._caps_cache.get(projection)
        if cached is not None:
            return cached
        xml = await request_text("NASA GIBS", "GET", self.capabilities_url(projection), timeout_s=40.0)
        if "<Capabilities" not in xml:
            raise UpstreamError("NASA GIBS", "GIBS capabilities document was not valid WMTS XML.")
        self._caps_cache.set(projection, xml)
        return xml

    def parse_capabilities(self, xml: str) -> Dict[str, LayerInfo]:
        """Extract layers with title/format/TMS/temporal range from GetCapabilities."""
        out: Dict[str, LayerInfo] = {}
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            root = None
        ns = {"ows": "http://www.opengis.net/ows/1.1", "wmts": "http://www.opengis.net/wmts/1.0"}

        if root is not None:
            for layer in root.iter("{http://www.opengis.net/wmts/1.0}Layer"):
                ident = layer.findtext("ows:Identifier", default="", namespaces=ns)
                if not ident:
                    continue
                title = layer.findtext("ows:Title", default=ident, namespaces=ns) or ident
                fmt = layer.findtext("Format", default="image/jpeg", namespaces=ns) or "image/jpeg"
                tms_el = layer.find("TileMatrixSetLink/TileMatrixSet", namespaces=ns)
                tms = (tms_el.text if tms_el is not None else "GoogleMapsCompatible_Level9") or "GoogleMapsCompatible_Level9"
                start = end = None
                period = None
                lower = layer.find(".//ows:LowerCorner", namespaces=ns)
                upper = layer.find(".//ows:UpperCorner", namespaces=ns)
                if lower is not None and upper is not None and lower.text and upper.text:
                    start = lower.text.split(" ")[0][:10]
                    end = upper.text.split(" ")[0][:10]
                if start is None:
                    tp = layer.find(".//ows:TimePeriod", namespaces=ns)
                    if tp is not None:
                        s = tp.findtext("ows:BeginPosition", namespaces=ns) or tp.findtext("ows:StartPosition", namespaces=ns)
                        e = tp.findtext("ows:EndPosition", namespaces=ns)
                        start = (s or "")[:10] or None
                        end = (e or "")[:10] or None
                    dur = layer.findtext(".//ows:Duration", namespaces=ns)
                    period = dur or None
                out[ident] = LayerInfo(
                    id=ident,
                    title=title,
                    format=fmt,
                    projection="EPSG3857",
                    tile_matrix_set=tms,
                    temporal_start=start,
                    temporal_end=end,
                    temporal_period=period or "P1D",
                    attribution=ACK,
                )
        if not out:  # regex fallback for odd documents
            for ident, block in _LAYER_TITLE_RE.findall(xml):
                title_m = _TITLE_RE.search(block)
                fmt_m = _FORMAT_RE.search(block)
                tms_m = _TMS_RE.search(block)
                period_m = _PERIOD_RE.search(block)
                start = end = None
                if period_m:
                    iv = _INTERVAL_RE.search(period_m.group(1))
                    if iv:
                        start, end = iv.group(1)[:10], iv.group(2)[:10]
                out[ident] = LayerInfo(
                    id=ident,
                    title=title_m.group(1) if title_m else ident,
                    format=fmt_m.group(1) if fmt_m else "image/jpeg",
                    projection="EPSG3857",
                    tile_matrix_set=tms_m.group(1) if tms_m else "GoogleMapsCompatible_Level9",
                    temporal_start=start,
                    temporal_end=end,
                    temporal_period="P1D",
                    attribution=ACK,
                )
        return out

    async def discover_layers(self) -> List[LayerInfo]:
        """Curated, verified subset - never the whole 1000+ layer catalog."""
        if self._layers_cache is None:
            caps: Dict[str, LayerInfo] = {}
            try:
                caps = self.parse_capabilities(await self.fetch_capabilities("EPSG3857"))
            except UpstreamError:
                caps = {}
            merged: Dict[str, LayerInfo] = {}
            for lid, meta in VERIFIED_LAYERS.items():
                info = caps.get(lid)
                if info is None:
                    info = LayerInfo(
                        id=lid,
                        title=meta["title"],
                        format="image/jpeg",
                        projection="EPSG3857",
                        tile_matrix_set="GoogleMapsCompatible_Level9" if lid.startswith("MODIS") else "GoogleMapsCompatible_Level8",
                        temporal_start=DEFAULT_START.isoformat(),
                        temporal_end=None,
                        temporal_period="P1D",
                        attribution=ACK,
                    )
                info.title = meta["title"]
                merged[lid] = info
            self._layers_cache = merged
        return list(self._layers_cache.values())

    async def get_layer(self, layer_id: str) -> LayerInfo:
        layers = await self.discover_layers()
        for layer in layers:
            if layer.id == layer_id:
                return layer
        raise UpstreamError(
            "NASA GIBS",
            f"Layer '{layer_id}' is not in the verified layer set. Available: {', '.join(l.id for l in layers)}.",
            status_code=400,
        )

    # ─────────────────────────── temporal helpers ───────────────────────
    def latest_available_date(self, layer: LayerInfo, today: Optional[date] = None) -> date:
        today = today or datetime.now(timezone.utc).date()
        latest = today - timedelta(days=INGEST_LAG_DAYS)
        if layer.temporal_end:
            try:
                end = date.fromisoformat(layer.temporal_end[:10])
                latest = min(latest, end)
            except ValueError:
                pass
        return latest

    def earliest_available_date(self, layer: LayerInfo) -> date:
        if layer.temporal_start:
            try:
                return date.fromisoformat(layer.temporal_start[:10])
            except ValueError:
                pass
        return DEFAULT_START

    def validate_date(self, layer: LayerInfo, iso_date: str, today: Optional[date] = None) -> Tuple[bool, Optional[str]]:
        try:
            d = date.fromisoformat(iso_date)
        except ValueError:
            return False, f"'{iso_date}' is not a valid ISO date (YYYY-MM-DD)."
        earliest, latest = self.earliest_available_date(layer), self.latest_available_date(layer, today)
        if d < earliest:
            return False, f"{iso_date} is before this layer's coverage start ({earliest.isoformat()})."
        if d > latest:
            return False, (
                f"{iso_date} has no composite yet for {layer.id}. Latest available is {latest.isoformat()} "
                f"(giBS imagery is not live; there is roughly a {INGEST_LAG_DAYS}-day ingest lag)."
            )
        return True, None

    def available_dates(self, layer: LayerInfo, days: int = 30, today: Optional[date] = None) -> Tuple[List[ObservationDate], ObservationDate]:
        today = today or datetime.now(timezone.utc).date()
        latest = self.latest_available_date(layer, today)
        out: List[ObservationDate] = []
        for i in range(days):
            d = latest - timedelta(days=i)
            ok, reason = self.validate_date(layer, d.isoformat(), today)
            out.append(ObservationDate(date=d.isoformat(), available=ok, reason=reason if not ok else None))
        latest_obs = out[0]
        return out, latest_obs

    # ─────────────────────────── tile plan ──────────────────────────────
    def tile_extension(self, layer: LayerInfo) -> str:
        fmt = (layer.format or "image/jpeg").lower()
        if "png" in fmt:
            return "png"
        # GIBS serves JPEG tiles with a ".jpeg" extension in its own ResourceURL
        # templates. ".jpg" returns 404 on most layers, so match the capabilities.
        return "jpeg"

    def build_tile_plan(self, layer: LayerInfo, iso_date: str, today: Optional[date] = None) -> ImageryTilePlan:
        ok, reason = self.validate_date(layer, iso_date, today)
        if not ok:
            raise UpstreamError("NASA GIBS", reason or "Date unavailable.", status_code=400)
        level = 6
        m = re.search(r"Level(\d+)", layer.tile_matrix_set)
        if m:
            level = int(m.group(1))
        # Use the layer's OWN TileMatrixSet from the capabilities. Rewriting it to
        # a generic "GoogleMapsCompatible" makes GIBS reject every tile with
        # "TILEMATRIXSET is invalid for LAYER" (e.g. MODIS true colour requires
        # GoogleMapsCompatible_Level9, not GoogleMapsCompatible).
        template = (
            f"{WMTS_ROOT}/epsg3857/best/{layer.id}/default/{{time}}/{{tms}}/{{z}}/{{y}}/{{x}}.{{ext}}"
            .replace("{tms}", layer.tile_matrix_set)
        )
        d = date.fromisoformat(iso_date)
        # Honour the injected `today` so freshness is deterministic in tests and
        # when replaying a plan; falling back to the wall clock otherwise.
        ref = today or datetime.now(timezone.utc).date()
        age_days = (ref - d).days
        freshness = Freshness.RECENT_OBSERVATION if age_days <= 3 else Freshness.HISTORICAL
        return ImageryTilePlan(
            layer_id=layer.id,
            title=layer.title,
            date=iso_date,
            projection="EPSG:3857",
            tile_matrix_set=layer.tile_matrix_set,
            tile_template=template.replace("{time}", iso_date),
            format=layer.format,
            max_zoom=min(level, 9),
            attribution=ACK,
            provenance=Provenance(
                provider="NASA GIBS",
                product=f"WMTS {layer.id}",
                observation_time=f"{iso_date} (daily composite)",
                retrieval_time=utcnow().isoformat(),
                freshness=freshness,
                attribution=layer.attribution,
                source_url=(
                    f"{WMTS_ROOT}/epsg3857/best/{layer.id}/default/{iso_date}/"
                    f"{layer.tile_matrix_set}/0/0/0.{self.tile_extension(layer)}"
                ),
                note="Daily composite imagery - not a live sensor feed.",
            ),
            warnings=[
                "Daily composite product; individual satellite passes are not shown.",
                "Imagery is rendered with a green HUD tint by the S.A.T.U.R.N. globe.",
            ],
        )


gibs = GIBSClient()

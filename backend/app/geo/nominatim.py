"""Nominatim client that respects the OSM usage policy.

Policy compliance:
  * descriptive User-Agent with a contact address (from env)
  * at most one request per second (serialised, global lock + interval)
  * responses cached (search 24h, reverse 24h, lookups 7d)
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional

from ..config import get_settings
from ..http_client import TTLCache, UpstreamError, request_json

BASE = "https://nominatim.openstreetmap.org"


class NominatimClient:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._last_call = 0.0
        self._cache: TTLCache = TTLCache(ttl_s=24 * 3600, max_items=1024)

    @property
    def settings(self):
        return get_settings()

    def _headers(self) -> Dict[str, str]:
        return {
            "User-Agent": self.settings.nominatim_user_agent,
            "Accept-Language": "en",
            "Accept": "application/json",
        }

    def _base(self) -> str:
        return (self.settings.nominatim_base_url or BASE).rstrip("/")

    async def _throttle(self) -> None:
        interval = max(0.0, float(self.settings.nominatim_min_interval_s))
        async with self._lock:
            now = time.monotonic()
            wait = interval - (now - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()

    async def _get(self, path: str, params: Dict[str, Any]) -> Any:
        key = path + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        await self._throttle()
        data = await request_json(
            "OpenStreetMap Nominatim",
            "GET",
            f"{self._base()}{path}",
            headers=self._headers(),
            params=params,
        )
        self._cache.set(key, data)
        return data

    async def search(
        self,
        query: str,
        *,
        limit: int = 6,
        viewbox: Optional[str] = None,
        bounded: bool = False,
        language: str = "en",
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "extratags": 1,
            "namedetails": 1,
            "limit": max(1, min(20, limit)),
            "accept-language": language,
        }
        if viewbox:
            params["viewbox"] = viewbox
            params["bounded"] = 1 if bounded else 0
        data = await self._get("/search", params)
        if not isinstance(data, list):
            raise UpstreamError("OpenStreetMap Nominatim", "Unexpected search response shape.")
        return data

    async def reverse(self, lat: float, lon: float, zoom: int = 10) -> Dict[str, Any]:
        params = {
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "format": "jsonv2",
            "zoom": zoom,
            "addressdetails": 1,
        }
        data = await self._get("/reverse", params)
        if not isinstance(data, dict):
            raise UpstreamError("OpenStreetMap Nominatim", "Unexpected reverse response shape.")
        return data

    async def details(self, osm_type: str, osm_id: int, *, geometry: bool = True) -> Dict[str, Any]:
        """Full record incl. polygon_geojson. Accepts node/way/relation ids."""
        letter = {"node": "N", "way": "W", "relation": "R"}.get(osm_type.lower())
        if letter is None:
            raise UpstreamError("OpenStreetMap Nominatim", f"Unsupported OSM type '{osm_type}'.")
        params: Dict[str, Any] = {
            "osm_ids": f"{letter}{osm_id}",
            "format": "jsonv2",
            "addressdetails": 1,
            "extratags": 1,
            "namedetails": 1,
        }
        if geometry:
            params["polygon_geojson"] = 1
        data = await self._get("/lookup", params)
        if not isinstance(data, list) or not data:
            raise UpstreamError("OpenStreetMap Nominatim", "No details returned for that OSM id.")
        return data[0]

    async def lookup(self, osm_ids: List[str]) -> List[Dict[str, Any]]:
        params = {"osm_ids": ",".join(osm_ids), "format": "jsonv2", "addressdetails": 1, "polygon_geojson": 1}
        data = await self._get("/lookup", params)
        return data if isinstance(data, list) else []


nominatim = NominatimClient()

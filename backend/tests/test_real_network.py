"""REAL NETWORK integration tests - skipped unless SATURN_REAL_NETWORK=1.

Run:  $env:SATURN_REAL_NETWORK=1; .\\.venv\\Scripts\\python.exe -m pytest tests/test_real_network.py -v

These call the live OpenStreetMap Nominatim and NASA GIBS services and are
therefore labelled separately from the mock-based suite.
"""

from __future__ import annotations

import asyncio
import os
from datetime import date, timedelta

import pytest

REAL = os.environ.get("SATURN_REAL_NETWORK") == "1"
pytestmark = pytest.mark.skipif(not REAL, reason="set SATURN_REAL_NETWORK=1 to run live provider tests")


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.mark.parametrize("query", ["South Korea", "London", "Amazon rainforest", "Pacific Ocean"])
def test_live_resolve(query):
    from app.geo.location_service import resolve_location

    res = run(resolve_location(query))
    assert res.status in ("resolved", "ambiguous")
    assert res.candidates
    assert res.provenance.provider.startswith("OpenStreetMap")


def test_live_coordinate():
    from app.geo.location_service import resolve_location

    res = run(resolve_location("12.9716, 77.5846"))
    assert res.status == "resolved"
    assert res.best.lat == pytest.approx(12.9716)


def test_live_gibs_layers_and_tile():
    from app.imagery.gibs import gibs

    layers = run(gibs.discover_layers())
    assert layers
    latest = gibs.latest_available_date(layers[0])
    plan = gibs.build_tile_plan(layers[0], latest.isoformat())
    import httpx

    url = plan.tile_template.replace("{z}", "0").replace("{y}", "0").replace("{x}", "0")
    resp = httpx.get(url, timeout=30.0)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/")

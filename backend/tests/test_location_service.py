"""Location resolution - mock-based (hermetic) tests.

The Nominatim HTTP layer is replaced with recorded-shape fixtures so the tests
never touch the network. A real network smoke test lives in
tests/test_real_network.py and is opt-in via SATURN_REAL_NETWORK=1.
"""

from __future__ import annotations

import asyncio

import pytest

from app.geo import location_service
from app.geo.location_service import parse_coordinates, resolve_location
from app.http_client import UpstreamError

SOUTH_KOREA = {
    "place_id": 1,
    "osm_type": "relation",
    "osm_id": 307756,
    "lat": "36.5000",
    "lon": "127.7500",
    "name": "South Korea",
    "display_name": "South Korea",
    "class": "boundary",
    "type": "administrative",
    "importance": 0.9,
    "boundingbox": ["33.0", "37.0", "124.5", "130.0"],
    "address": {"country": "South Korea", "country_code": "kr"},
}

LONDON = {
    "place_id": 2,
    "osm_type": "relation",
    "osm_id": 65606,
    "lat": "51.5073",
    "lon": "-0.1276",
    "name": "London",
    "display_name": "London, England, UK",
    "class": "boundary",
    "type": "administrative",
    "importance": 0.85,
    "boundingbox": ["51.28", "51.69", "-0.51", "0.33"],
    "address": {"country": "United Kingdom", "country_code": "gb"},
}

SPRINGFIELD = [
    SOUTH_KOREA
    | {
        "name": "Springfield",
        "display_name": "Springfield, Illinois",
        "address": {"country": "United States", "country_code": "us"},
        "importance": 0.6,
    },
    LONDON
    | {
        "name": "Springfield",
        "display_name": "Springfield, England",
        "address": {"country": "United Kingdom", "country_code": "gb"},
        "importance": 0.58,
    },
]


def _fake_monkey(monkeypatch, results, details=None, reverse=None, error=None):
    async def fake_search(*a, **k):
        if error:
            raise error
        return results

    async def fake_details(*a, **k):
        return details or {}

    async def fake_reverse(*a, **k):
        return reverse or {}

    monkeypatch.setattr(location_service.nominatim, "search", fake_search)
    monkeypatch.setattr(location_service.nominatim, "details", fake_details)
    monkeypatch.setattr(location_service.nominatim, "reverse", fake_reverse)


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


def test_named_country_resolves(monkeypatch):
    _fake_monkey(monkeypatch, [SOUTH_KOREA])
    res = run(resolve_location("South Korea"))
    assert res.status == "resolved"
    assert res.best.name == "South Korea"
    assert res.best.bbox == [33.0, 124.5, 37.0, 130.0]
    assert res.boundary is not None
    assert res.boundary.is_exact is False  # no polygon returned by provider -> bbox outline
    assert any("approximate" in w for w in res.warnings)
    assert res.provenance.provider.startswith("OpenStreetMap")


def test_verified_polygon_is_marked_exact(monkeypatch):
    polygon = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
    _fake_monkey(monkeypatch, [LONDON], details={"geojson": polygon})
    res = run(resolve_location("London"))
    assert res.boundary is not None and res.boundary.is_exact is True
    assert res.boundary.type == "Polygon"


def test_ambiguous_name_needs_clarification(monkeypatch):
    _fake_monkey(monkeypatch, SPRINGFIELD)
    res = run(resolve_location("Springfield"))
    assert res.status == "ambiguous"
    assert res.needs_clarification is True
    assert res.best is None
    assert len(res.candidates) == 2


def test_ambiguous_but_allow_flag(monkeypatch):
    _fake_monkey(monkeypatch, SPRINGFIELD)
    res = run(resolve_location("Springfield", allow_ambiguous=True))
    assert res.status == "resolved"
    assert res.best is not None


def test_not_found(monkeypatch):
    _fake_monkey(monkeypatch, [])
    res = run(resolve_location("Xqzwv-invalid-place-name"))
    assert res.status == "not_found"
    assert res.best is None


def test_provider_down_is_reported(monkeypatch):
    _fake_monkey(monkeypatch, [], error=UpstreamError("OpenStreetMap Nominatim", "timed out"))
    res = run(resolve_location("Seoul"))
    assert res.status == "not_found"
    assert any("unavailable" in w for w in res.warnings)


def test_coordinates_resolve_without_search(monkeypatch):
    calls = {"n": 0}

    async def fake_reverse(*a, **k):
        return {"display_name": "Karnataka, India", "address": {"country": "India", "country_code": "in"}, "type": "state"}

    async def fake_search(*a, **k):
        calls["n"] += 1
        return []

    monkeypatch.setattr(location_service.nominatim, "reverse", fake_reverse)
    monkeypatch.setattr(location_service.nominatim, "search", fake_search)
    res = run(resolve_location("12.9716, 77.5846"))
    assert res.status == "resolved"
    assert res.best.kind == "coordinate"
    assert res.best.lat == pytest.approx(12.9716)
    assert calls["n"] == 0


def test_invalid_coordinate_is_invalid():
    res = run(resolve_location("91.0, 200.0"))
    assert res.status == "invalid"
    assert res.best is None


def test_coordinate_parser():
    assert parse_coordinates("12.9716, 77.5846") == (12.9716, 77.5846)
    assert parse_coordinates("12.9716 77.5846") == (12.9716, 77.5846)
    assert parse_coordinates("hello") is None
    with pytest.raises(Exception):
        parse_coordinates("95, 10")


def test_ocean_query_returns_point_no_boundary(monkeypatch):
    ocean = SOUTH_KOREA | {
        "name": "Pacific Ocean",
        "display_name": "Pacific Ocean",
        "class": "natural",
        "type": "ocean",
        "boundingbox": ["-60", "60", "-160", "-100"],
        "address": {},
    }
    _fake_monkey(monkeypatch, [ocean])
    res = run(resolve_location("Pacific Ocean"))
    assert res.status == "resolved"
    # provider returns no polygon for oceans -> approximate bbox outline, flagged
    assert res.boundary is not None and res.boundary.is_exact is False

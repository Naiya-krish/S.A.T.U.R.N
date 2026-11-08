"""Region queries must not resolve to tiny same-named features.

Regression: "Amazon rainforest" resolved to a garden near Los Angeles because an
OSM node carries that exact name and won on importance. A confident wrong answer
is worse than an honest approximation.
"""

from __future__ import annotations

import pytest

from app.geo import location_service as ls


def _cand(name, lat, lon, bbox, importance=0.2, type_="garden"):
    return ls.LocationCandidate(
        id=name,
        name=name,
        type=type_,
        category="leisure",
        country="United States",
        country_code="us",
        lat=lat,
        lon=lon,
        bbox=bbox,
        importance=importance,
        score=importance * 100,
        kind="location",
        display_name=name,
    )


def _prov():
    from app.models import Freshness, Provenance

    return Provenance(
        provider="OpenStreetMap Nominatim",
        product="geocoding",
        observation_time=None,
        retrieval_time="2026-01-01T00:00:00+00:00",
        freshness=Freshness.RECENT_OBSERVATION,
        attribution="© OpenStreetMap contributors (ODbL)",
    )


def test_looks_regional_detects_region_words():
    assert ls._looks_regional("Amazon rainforest")
    assert ls._looks_regional("Sahara desert")
    assert not ls._looks_regional("London")
    assert not ls._looks_regional("Seoul")


def test_tiny_same_named_feature_does_not_win_a_regional_query():
    # The real-world failure: a small garden named "Amazon Rainforest" in LA.
    tiny = _cand("Amazon Rainforest", 34.19, -118.53, [34.189, -118.531, 34.191, -118.529])
    res = ls.ResolveResponse(
        query="Amazon rainforest",
        status="resolved",
        best=None,
        candidates=[tiny],
        needs_clarification=False,
        warnings=[],
        provenance=_prov(),
    )
    out = ls._prefer_high_importance(res, limit=5)
    assert out.best is not None
    # Must not point at the Los Angeles garden.
    assert not (33 < out.best.lat < 35), f"resolved to Los Angeles: {out.best.lat},{out.best.lon}"
    # Must say the answer is a reference point, not an outline.
    assert any("reference point" in w.lower() for w in out.warnings)


def test_regional_reference_covers_common_oceans_and_regions():
    for name in ("Amazon rainforest", "Pacific Ocean", "Sahara desert", "Antarctica"):
        assert ls._regional_reference(name) is not None, name


def test_normal_specific_query_is_unaffected():
    london = _cand("London", 51.5074, -0.1278, [51.28, -0.51, 51.69, 0.33], importance=0.85, type_="city")
    res = ls.ResolveResponse(
        query="London",
        status="resolved",
        best=None,
        candidates=[london],
        needs_clarification=False,
        warnings=[],
        provenance=_prov(),
    )
    # Not regional -> guard must not fire, and strong match promotes it as-is.
    out = ls._apply_strong_match(res)
    assert out.best is not None
    assert out.best.name == "London"

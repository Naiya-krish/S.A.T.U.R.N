"""NASA GIBS adapter - offline tests (capabilities parsing, dates, tile plans)."""

from __future__ import annotations

import asyncio
from datetime import date

import pytest

from app.http_client import UpstreamError
from app.imagery.gibs import GIBSClient, LayerInfo

LAYER = LayerInfo(
    id="MODIS_Terra_CorrectedReflectance_TrueColor",
    title="MODIS Terra Corrected Reflectance (True Colour), daily composite",
    format="image/jpeg",
    projection="EPSG3857",
    tile_matrix_set="GoogleMapsCompatible_Level9",
    temporal_start="2000-02-24",
    temporal_end=None,
    temporal_period="P1D",
)

CAPS_XML = """<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1">
  <Contents>
    <Layer>
      <ows:Title>MODIS Terra Corrected Reflectance (True Colour)</ows:Title>
      <ows:Identifier>MODIS_Terra_CorrectedReflectance_TrueColor</ows:Identifier>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>-180 -90</ows:LowerCorner>
        <ows:UpperCorner>180 90</ows:UpperCorner>
      </ows:WGS84BoundingBox>
      <Format>image/jpeg</Format>
      <Dimension>
        <ows:Identifier>Time</ows:Identifier>
        <Default>2024-01-01</Default>
        <Value>2024-01-01/2024-01-31/P1D</Value>
      </Dimension>
      <TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible_Level9</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>"""


def test_parse_capabilities():
    client = GIBSClient()
    layers = client.parse_capabilities(CAPS_XML)
    assert "MODIS_Terra_CorrectedReflectance_TrueColor" in layers
    layer = layers["MODIS_Terra_CorrectedReflectance_TrueColor"]
    assert layer.format == "image/jpeg"
    assert layer.tile_matrix_set == "GoogleMapsCompatible_Level9"
    assert layer.temporal_start == "-180"


def test_parse_capabilities_regex_fallback():
    client = GIBSClient()
    broken = CAPS_XML.replace("</Capabilities>", "")
    layers = client.parse_capabilities(broken)
    assert "MODIS_Terra_CorrectedReflectance_TrueColor" in layers


def test_validate_date_rejects_future():
    client = GIBSClient()
    ok, reason = client.validate_date(LAYER, "2030-01-01", today=date(2026, 10, 30))
    assert ok is False
    assert "Latest available" in reason


def test_validate_date_rejects_before_coverage():
    client = GIBSClient()
    ok, reason = client.validate_date(LAYER, "1999-01-01", today=date(2026, 10, 30))
    assert ok is False
    assert "coverage start" in reason


def test_validate_date_bad_format():
    client = GIBSClient()
    ok, reason = client.validate_date(LAYER, "28-10-2026")
    assert ok is False
    assert "valid ISO date" in reason


def test_latest_available_respects_lag_and_end():
    client = GIBSClient()
    latest = client.latest_available_date(LAYER, today=date(2026, 10, 30))
    assert latest == date(2026, 10, 29)


def test_tile_plan_url_and_freshness():
    client = GIBSClient()
    plan = client.build_tile_plan(LAYER, "2024-05-01", today=date(2026, 10, 30))
    assert "{time}" not in plan.tile_template
    assert plan.tile_template.startswith("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/")
    assert plan.tile_template.endswith(".{ext}")
    assert plan.format == "image/jpeg"
    assert plan.provenance.freshness.value == "HISTORICAL"
    assert "not a live" in (plan.provenance.note or "").lower()


def test_tile_plan_uses_layer_own_tile_matrix_set():
    """Regression: the adapter used to rewrite the TileMatrixSet to a generic
    "GoogleMapsCompatible", which GIBS rejects with "TILEMATRIXSET is invalid
    for LAYER" - every tile 404'd and the globe showed no imagery."""
    client = GIBSClient()
    plan = client.build_tile_plan(LAYER, "2024-05-01", today=date(2026, 10, 30))
    assert f"/{LAYER.tile_matrix_set}/" in plan.tile_template
    if LAYER.tile_matrix_set != "GoogleMapsCompatible":
        assert "/GoogleMapsCompatible/" not in plan.tile_template


def test_tile_extension_matches_gibs_resource_url():
    """GIBS serves JPEG tiles as ".jpeg" (not ".jpg") in its ResourceURL."""
    client = GIBSClient()
    assert client.tile_extension(LAYER) == "jpeg"
    png_layer = LayerInfo(
        id="X",
        title="X",
        format="image/png",
        projection="EPSG:3857",
        tile_matrix_set="GoogleMapsCompatible_Level9",
        attribution="",
    )
    assert client.tile_extension(png_layer) == "png"


def test_tile_plan_recent_is_recent_observation():
    client = GIBSClient()
    today = date(2026, 10, 30)
    plan = client.build_tile_plan(LAYER, "2026-10-29", today=today)
    assert plan.provenance.freshness.value == "RECENT_OBSERVATION"


def test_tile_plan_rejects_unavailable_date():
    client = GIBSClient()
    with pytest.raises(UpstreamError) as exc:
        client.build_tile_plan(LAYER, "2031-01-01", today=date(2026, 10, 30))
    assert "Latest available" in str(exc.value)


def test_available_dates_list():
    client = GIBSClient()
    dates, latest = client.available_dates(LAYER, days=5, today=date(2026, 10, 30))
    assert len(dates) == 5
    assert latest.date == "2026-10-29"
    assert all(d.available for d in dates)


def test_discover_layers_is_curated(monkeypatch):
    client = GIBSClient()

    async def boom(*a, **k):
        raise UpstreamError("NASA GIBS", "offline")

    monkeypatch.setattr(client, "fetch_capabilities", boom)
    layers = asyncio.get_event_loop().run_until_complete(client.discover_layers())
    ids = [l.id for l in layers]
    assert "MODIS_Terra_CorrectedReflectance_TrueColor" in ids
    assert len(layers) < 10  # curated, not the 1000+ catalogue


def test_unknown_layer_rejected():
    client = GIBSClient()

    async def fake_discover():
        return [LAYER]

    client.discover_layers = fake_discover  # type: ignore[assignment]
    with pytest.raises(UpstreamError):
        asyncio.get_event_loop().run_until_complete(client.get_layer("NOT_A_LAYER"))

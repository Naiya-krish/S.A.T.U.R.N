import pytest

from app.geo.coords import (
    BBox,
    CoordinateError,
    bbox_from_pairs,
    geometry_bbox,
    haversine_km,
    validate_lat_lon,
    wrap_longitude,
)


def test_validate_lat_lon_ok():
    assert validate_lat_lon("12.9716", "77.5846") == (12.9716, 77.5846)
    assert validate_lat_lon(-90, 180) == (-90, 180)


@pytest.mark.parametrize(
    "lat,lon",
    [(91, 0), (-91, 0), (0, 181), (0, -181), ("abc", 0), (None, 0)],
)
def test_validate_lat_lon_rejects(lat, lon):
    with pytest.raises(CoordinateError):
        validate_lat_lon(lat, lon)


def test_wrap_longitude():
    assert wrap_longitude(190) == -170
    assert wrap_longitude(-190) == 170
    assert wrap_longitude(180) == 180
    assert wrap_longitude(-180) == -180
    assert wrap_longitude(0) == 0


def test_bbox_validation_and_antimeridian():
    box = BBox(-10, 170, 10, -170)
    assert box.crosses_antimeridian
    lat_span, lon_span = box.span()
    assert lat_span == 20
    assert lon_span == 20
    ring = box.to_geojson_ring()
    assert ring[0] == ring[-1]
    assert any(lon > 180 for lon, _ in ring)  # unwrapped across the antimeridian


def test_bbox_rejects_inverted():
    with pytest.raises(CoordinateError):
        BBox(10, 0, -10, 10)


def test_bbox_from_pairs_orders_latitudes():
    box = bbox_from_pairs(sw=[10, 20], ne=[-10, 30])
    assert box is not None
    assert (box.south, box.north) == (-10, 10)


def test_haversine_known_distance():
    # Delhi -> Mumbai ~ 1150 km
    d = haversine_km(28.6139, 77.2090, 19.0760, 72.8777)
    assert 1100 < d < 1200


def test_bbox_center_antimeridian():
    lat, lon = BBox(-20, 170, -10, -170).center()
    assert lon == 180 or lon == -180


def test_geometry_bbox_unwraps_antimeridian():
    s, w, n, e = geometry_bbox([(179, 30), (-179, 31), (178, 29)])
    assert s == 29 and n == 31
    assert w > 170 and e is not None

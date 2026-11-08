"""Coordinate helpers shared by the geo services and tile builders.

Conventions used across S.A.T.U.R.N.:
  * latitude  in [-90, 90], longitude in [-180, 180]
  * bounding boxes are (south, west, north, east)
  * antimeridian-crossing boxes have west > east (e.g. 170 .. -170)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple


class CoordinateError(ValueError):
    """Raised when a coordinate or bounding box is invalid."""


def wrap_longitude(lon: float) -> float:
    """Wrap any longitude into (-180, 180]."""
    wrapped = ((lon + 180.0) % 360.0) - 180.0
    if wrapped == -180.0 and lon > 0:
        return 180.0
    return wrapped


def validate_lat_lon(lat: float | None, lon: float | None) -> Tuple[float, float]:
    try:
        lat_f = float(lat)  # type: ignore[arg-type]
        lon_f = float(lon)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise CoordinateError("Latitude and longitude must be numbers.")
    if lat_f != lat_f or lon_f != lon_f:  # NaN
        raise CoordinateError("Latitude and longitude must be finite numbers.")
    if not (-90.0 <= lat_f <= 90.0):
        raise CoordinateError(f"Latitude {lat_f} is out of range (-90..90).")
    if not (-180.0 <= lon_f <= 180.0):
        raise CoordinateError(f"Longitude {lon_f} is out of range (-180..180).")
    return lat_f, lon_f


@dataclass(frozen=True)
class BBox:
    south: float
    west: float
    north: float
    east: float

    def __post_init__(self) -> None:
        if not (-90.0 <= self.south <= 90.0 and -90.0 <= self.north <= 90.0):
            raise CoordinateError("Bounding box latitudes must be within -90..90.")
        if self.south > self.north:
            raise CoordinateError("Bounding box south must be <= north.")
        if not (-180.0 <= self.west <= 180.0 and -180.0 <= self.east <= 180.0):
            raise CoordinateError("Bounding box longitudes must be within -180..180.")

    @property
    def crosses_antimeridian(self) -> bool:
        return self.west > self.east

    def to_list(self) -> List[float]:
        return [self.south, self.west, self.north, self.east]

    def to_nominatim(self) -> str:
        """'west,north,east,south' as Nominatim expects (viewbox)."""
        return f"{self.west},{self.north},{self.east},{self.south}"

    def to_geojson_ring(self, steps: int = 8, inset: float = 0.0) -> List[List[float]]:
        """A closed [lon, lat] ring. Antimeridian safe: unwraps longitudes > 180."""
        s, w, n, e = self.south + inset, self.west, self.north - inset, self.east
        if e < w:  # crossing: pretend the east edge continues past +180
            e_unwrapped = e + 360.0
        else:
            e_unwrapped = e
        w_unwrapped = w
        ring: List[List[float]] = []
        for i in range(steps + 1):
            lo = w_unwrapped + (e_unwrapped - w_unwrapped) * i / steps
            ring.append([wrap_longitude(lo) if lo <= 180 else lo, n])
        for i in range(steps + 1):
            lo = e_unwrapped - (e_unwrapped - w_unwrapped) * i / steps
            ring.append([wrap_longitude(lo) if lo <= 180 else lo, s])
        ring.append(ring[0])
        return ring

    def center(self) -> Tuple[float, float]:
        lat = (self.south + self.north) / 2.0
        if self.crosses_antimeridian:
            lon = wrap_longitude((self.west + (self.east + 360.0)) / 2.0)
        else:
            lon = (self.west + self.east) / 2.0
        return lat, lon

    def span(self) -> Tuple[float, float]:
        """(lat span, lon span) in degrees; lon span is positive across antimeridian."""
        lat_span = self.north - self.south
        lon_span = (self.east + 360.0 - self.west) if self.crosses_antimeridian else (self.east - self.west)
        return lat_span, lon_span


def bbox_from_pairs(
    sw: Sequence[float] | None = None,
    ne: Sequence[float] | None = None,
    raw: Sequence[float] | None = None,
) -> BBox | None:
    """Build a BBox from sw/ne pairs or a south,west,north,east tuple."""
    if raw is not None:
        if len(raw) != 4:
            raise CoordinateError("bbox must contain 4 numbers: south, west, north, east.")
        s, w, n, e = (float(x) for x in raw)
        return BBox(s, w, n, e)
    if sw is not None and ne is not None:
        lat1, lon1 = validate_lat_lon(sw[0], sw[1])
        lat2, lon2 = validate_lat_lon(ne[0], ne[1])
        return BBox(min(lat1, lat2), lon1, max(lat1, lat2), lon2)
    return None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    r = 6371.0088
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(wrap_longitude(lon2 - lon1))
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * asin(min(1.0, sqrt(a)))


def geometry_bbox(coords: Iterable[Sequence[float]]) -> Tuple[float, float, float, float]:
    """BBox from flat [lon, lat] pairs (boundaries crossing ±180 are unwrapped)."""
    pts = [(float(c[0]), float(c[1])) for c in coords]
    if not pts:
        raise CoordinateError("Cannot compute a bounding box for an empty geometry.")
    lats = [p[1] for p in pts]
    lons = [p[0] for p in pts]
    # Shift negative longitudes into 0..360 when the polygon straddles ±180.
    if max(lons) > 170 and min(lons) < -170:
        lons = [l + 360.0 if l < 0 else l for l in lons]
        return min(lats), wrap_longitude(min(lons)), max(lats), wrap_longitude(max(lons))
    return min(lats), min(lons), max(lats), max(lons)

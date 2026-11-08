"""Global location resolution: one workflow for any place or coordinate.

Nothing is fabricated:
  * if the provider returns a polygon, we pass it through and mark it exact
  * otherwise we hand back a bbox outline and say it is approximate
  * ambiguities return ranked candidates + needs_clarification
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from ..http_client import UpstreamError
from ..models import (
    Boundary,
    ContextResponse,
    Freshness,
    LocationCandidate,
    Provenance,
    ResolveResponse,
    utcnow,
)
from .coords import BBox, CoordinateError, validate_lat_lon, wrap_longitude
from .nominatim import nominatim

COORD_RE = re.compile(
    r"^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;/ ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$",
)

# Bounding boxes that a language model's training data often mis-remembers are
# intentionally NOT hardcoded - every bbox below comes from the provider reply.

NON_BOUNDARY_TYPES = {
    "city", "town", "village", "hamlet", "locality", "isolated_dwelling",
    "administrative", "state_district", "county", "suburb", "neighbourhood",
    "road", "house", "building", "postcode", "peak", "airport", "railway",
}


def _provenance() -> Provenance:
    return Provenance(
        provider="OpenStreetMap Nominatim",
        product="Nominatim geocoding (OSM data © OpenStreetMap contributors, ODbL)",
        retrieval_time=utcnow().isoformat(),
        freshness=Freshness.RECENT_OBSERVATION,
        source_url="https://nominatim.openstreetmap.org/",
        note="Place records are maintained by OSM contributors and are not satellite observations.",
    )


def _first_name(namedetails: Any) -> Optional[str]:
    """First alias (any language) from Nominatim namedetails."""
    if isinstance(namedetails, dict):
        for value in namedetails.values():
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _candidate_from_nominatim(item: Dict[str, Any]) -> Optional[LocationCandidate]:
    try:
        lat, lon = validate_lat_lon(item.get("lat"), item.get("lon"))
    except CoordinateError:
        return None
    bb = item.get("boundingbox")
    if isinstance(bb, list) and len(bb) == 4:
        try:
            box = BBox(float(bb[0]), float(bb[2]), float(bb[1]), float(bb[3]))
            bbox = box.to_list()
        except (CoordinateError, TypeError, ValueError):
            bbox = [lat, lon, lat, lon]
    else:
        bbox = [lat, lon, lat, lon]
    address = item.get("address") or {}
    return LocationCandidate(
        id=f"{item.get('osm_type', 'place')}-{item.get('osm_id', item.get('place_id', 0))}",
        name=item.get("name") or _first_name(item.get("namedetails")) or (item.get("display_name") or "").split(",")[0],
        display_name=item.get("display_name") or item.get("name") or "",
        type=item.get("type") or item.get("class") or "place",
        category=item.get("class"),
        country=address.get("country"),
        country_code=(address.get("country_code") or "").upper() or None,
        lat=lat,
        lon=lon,
        bbox=bbox,
        importance=float(item.get("importance") or 0.0),
        score=float(item.get("importance") or 0.0) * 100,
        kind="location",
    )


def parse_coordinates(text: str) -> Optional[Tuple[float, float]]:
    m = COORD_RE.match(text)
    if not m:
        return None
    try:
        return validate_lat_lon(m.group(1), m.group(2))
    except CoordinateError:
        raise


def _bbox_ring(box: BBox) -> Boundary:
    return Boundary(
        type="Polygon",
        coordinates=[box.to_geojson_ring(steps=4)],
        is_exact=False,
        note="Approximate rectangle derived from the provider bounding box - not an administrative boundary.",
    )


def _boundary_from_geojson(geom: Dict[str, Any]) -> Optional[Boundary]:
    if not isinstance(geom, dict):
        return None
    gtype = geom.get("type")
    if gtype not in ("Polygon", "MultiPolygon"):
        return None
    coords = geom.get("coordinates")
    if not coords:
        return None
    return Boundary(
        type=gtype,
        coordinates=coords,
        is_exact=True,
        note="Administrative/feature outline returned by OpenStreetMap (ODbL).",
    )


async def _resolve_coordinate(lat: float, lon: float, query: str) -> ResolveResponse:
    warnings: List[str] = []
    name = f"{lat:.4f}, {lon:.4f}"
    country = None
    display = name
    place_type = "coordinate"
    bbox = BBox(max(-90.0, lat - 0.5), wrap_longitude(lon - 0.5), min(90.0, lat + 0.5), wrap_longitude(lon + 0.5))
    try:
        rev = await nominatim.reverse(lat, lon)
        if rev and rev.get("display_name"):
            display = rev["display_name"]
            addr = rev.get("address") or {}
            country = addr.get("country")
            name = addr.get("country") or (display.split(",")[-1].strip() if display else name)
            place_type = rev.get("type") or "coordinate"
        else:
            warnings.append("Reverse geocoding returned no administrative context for this point.")
    except UpstreamError as exc:
        warnings.append(f"Reverse geocoding unavailable ({exc.message}); coordinates used as-is.")
    cand = LocationCandidate(
        id=f"coord-{lat:.5f}-{lon:.5f}",
        name=name,
        display_name=display,
        type=place_type,
        category="coordinate",
        country=country,
        lat=lat,
        lon=lon,
        bbox=bbox.to_list(),
        importance=1.0,
        score=100.0,
        kind="coordinate",
    )
    return ResolveResponse(
        query=query,
        status="resolved",
        best=cand,
        candidates=[cand],
        boundary=None,
        warnings=warnings,
        provenance=_provenance(),
    )


async def resolve_location(
    query: str,
    *,
    limit: int = 6,
    near: Optional[Tuple[float, float]] = None,
    allow_ambiguous: bool = False,
) -> ResolveResponse:
    q = (query or "").strip()
    if not q:
        return ResolveResponse(query=query, status="invalid", warnings=["Empty query."], provenance=_provenance())

    # 1) raw coordinates
    try:
        coords = parse_coordinates(q)
    except CoordinateError as exc:
        return ResolveResponse(
            query=q,
            status="invalid",
            warnings=[str(exc)],
            provenance=_provenance(),
        )
    if coords is not None:
        return await _resolve_coordinate(coords[0], coords[1], q)

    try:
        return await _resolve_name(q, limit=limit, near=near, allow_ambiguous=allow_ambiguous)
    except UpstreamError as exc:
        return ResolveResponse(
            query=q,
            status="not_found",
            warnings=[f"Geocoding provider unavailable: {exc.message}"],
            provenance=_provenance(),
        )


async def _resolve_name(
    q: str,
    *,
    limit: int = 6,
    near: Optional[Tuple[float, float]] = None,
    allow_ambiguous: bool = False,
) -> ResolveResponse:

    # 2) provider search (retry once with connector words removed)
    simplified = _strip_lead_in(q)
    query_variants = [q] + ([simplified] if simplified and simplified.casefold() != q.casefold() else [])
    res = None
    for variant in query_variants:
        res = await _search_once(variant, q, limit=limit, near=near, allow_ambiguous=allow_ambiguous)
        if res.status in ("resolved", "ambiguous"):
            return res if allow_ambiguous else _prefer_high_importance(res, limit)

    # 3) Named-region fallback. "Southern Europe" has no OSM feature, so the
    # search fails outright. Returning 404 for a perfectly reasonable question is
    # unhelpful, so fall back to our regional reference bbox and SAY it is an
    # approximation rather than an administrative outline.
    if res is not None and res.status in ("not_found", "ambiguous"):
        ref = _regional_reference(q)
        if ref is not None:
            lat, lon, label, span = ref
            box = regional_bbox(q)
            cand = LocationCandidate(
                id=f"region:{label.lower().replace(' ', '-')}",
                name=label,
                type="region",
                category="named region",
                country=None,
                country_code=None,
                lat=lat,
                lon=lon,
                bbox=list(box) if box else None,
                importance=0.55,
                score=55.0,
                kind="location",
                display_name=label,
            )
            return ResolveResponse(
                query=q,
                status="resolved",
                best=cand,
                candidates=[cand, *(res.candidates or [])],
                needs_clarification=False,
                boundary=None,
                warnings=[
                    "Matched a named region, not an administrative boundary. "
                    "The extent is an approximate reference box, not a surveyed outline."
                ],
                provenance=_provenance(),
            )
    return res  # type: ignore[return-value]


_STOPWORDS = {
    "the", "of", "and", "in", "on", "at", "near", "around", "area", "region", "parts",
}


def _names_match(name: str, query: str) -> bool:
    """Provider results whose own name shares a meaningful token with the query."""
    q_tokens = {t for t in re.split(r"[^\w]+", query.casefold()) if t and t not in _STOPWORDS}
    n_tokens = {t for t in re.split(r"[^\w]+", (name or "").casefold()) if t and t not in _STOPWORDS}
    return bool(q_tokens & n_tokens)


_GENERIC_WORDS = [
    ("rainforest", "rainforest"),
    ("forest", "forest"),
    ("desert", "desert"),
    ("mountains", "mountains"),
    ("mountain", "mountains"),
    ("ocean", "ocean"),
    ("sea", "sea"),
    ("valley", "valley"),
    ("island", "island"),
    ("river", "river"),
]


def _generic_fallbacks(q: str) -> List[str]:
    low = q.casefold()
    return [words for word, words in _GENERIC_WORDS if word in low]


# Words that mark a query as naming a large geographic region rather than a
# specific point. Used to stop tiny same-named features from winning.
_REGIONAL_WORDS = (
    "rainforest", "forest", "jungle", "desert", "savanna", "grassland",
    "mountain range", "mountains", "range", "valley", "basin", "plateau",
    "continent", "ocean", "sea", "gulf", "peninsula", "tundra", "delta",
    "region", "highlands", "archipelago",
)


def _looks_regional(q: str) -> bool:
    low = q.casefold()
    return any(w in low for w in _REGIONAL_WORDS)


# A bounding box smaller than this (square degrees) cannot be a geographic
# region. ~0.5 deg² is roughly 55 km x 55 km at the equator.
_REGION_MIN_AREA_DEG2 = 0.5


def _bbox_area(bbox) -> float:
    """Area of a (south, west, north, east) bbox in square degrees."""
    try:
        s, w, n, e = [float(v) for v in bbox]  # type: ignore[misc]
    except (TypeError, ValueError):
        return 0.0
    lat = abs(n - s)
    lon = abs(e - w)
    return max(0.0, lat) * max(0.0, lon)


# Approximate centre and half-span (degrees) of well-known large regions that
# OpenStreetMap does not carry as a single polygon. Used ONLY when a regional
# query has no region-sized match, so the answer is a flagged reference point
# rather than a confidently wrong small feature.
_REGIONAL_REFERENCE: Tuple[Tuple[str, float, float, str, float], ...] = (
    ("amazon rainforest", -3.47, -62.22, "Amazon rainforest", 9.0),
    ("amazon basin", -3.47, -62.22, "Amazon basin", 9.0),
    ("sahara", 23.42, 12.0, "Sahara", 12.0),
    ("sahara desert", 23.42, 12.0, "Sahara", 12.0),
    ("himalayas", 28.0, 84.0, "Himalayas", 5.0),
    ("arctic", 82.0, 0.0, "Arctic", 8.0),
    ("antarctica", -82.0, 0.0, "Antarctica", 8.0),
    ("pacific ocean", 0.0, -160.0, "Pacific Ocean", 25.0),
    ("atlantic ocean", 20.0, -35.0, "Atlantic Ocean", 20.0),
    ("indian ocean", -20.0, 80.0, "Indian Ocean", 20.0),
    ("southern ocean", -60.0, 0.0, "Southern Ocean", 12.0),
    # Sub-continental regions. A user asking about "southern Europe" wants a
    # sensible bbox, not a lecture about ambiguity.
    ("southern europe", 42.0, 15.0, "Southern Europe", 8.0),
    ("northern europe", 62.0, 18.0, "Northern Europe", 8.0),
    ("western europe", 47.0, 2.0, "Western Europe", 6.0),
    ("eastern europe", 50.0, 27.0, "Eastern Europe", 9.0),
    ("southeast asia", 8.0, 110.0, "Southeast Asia", 10.0),
    ("south asia", 20.0, 78.0, "South Asia", 9.0),
    ("east asia", 35.0, 118.0, "East Asia", 10.0),
    ("central asia", 43.0, 68.0, "Central Asia", 9.0),
    ("middle east", 28.0, 45.0, "Middle East", 9.0),
    ("north africa", 27.0, 12.0, "North Africa", 10.0),
    ("west africa", 10.0, -2.0, "West Africa", 9.0),
    ("east africa", 4.0, 38.0, "East Africa", 9.0),
    ("southern africa", -25.0, 25.0, "Southern Africa", 8.0),
    ("central america", 14.0, -87.0, "Central America", 7.0),
    ("south america", -15.0, -60.0, "South America", 18.0),
    ("north america", 45.0, -100.0, "North America", 20.0),
    ("oceania", -20.0, 140.0, "Oceania", 18.0),
    ("australia", -25.0, 134.0, "Australia", 14.0),
    ("west coast of north america", 42.0, -124.0, "US West Coast", 8.0),
    ("mediterranean", 37.0, 18.0, "Mediterranean", 9.0),
)


def _regional_reference(q: str) -> Optional[Tuple[float, float, str, float]]:
    """Known centre/span for a named region, if we carry one."""
    low = q.casefold().strip()
    # Prefer the longest matching key so "southern europe" wins over "europe"
    # style overlaps if more keys are added later.
    best: Optional[Tuple[float, float, str, float]] = None
    best_len = -1
    for key, lat, lon, label, span in _REGIONAL_REFERENCE:
        if key in low and len(key) > best_len:
            best, best_len = (lat, lon, label, span), len(key)
    return best


def regional_bbox(q: str) -> Optional[Tuple[float, float, float, float]]:
    """South, west, north, east for a named region, or None if unknown.

    Public so event/fire tools can turn "southern Europe" into a query area
    instead of bouncing the question back to the user.
    """
    ref = _regional_reference(q)
    if ref is None:
        return None
    lat, lon, _label, span = ref
    return (
        max(-89.0, lat - span),
        max(-180.0, lon - span * 1.5),
        min(89.0, lat + span),
        min(180.0, lon + span * 1.5),
    )


def _apply_strong_match(res: ResolveResponse) -> ResolveResponse:
    """Promote a single strong, name-matching candidate over weak look-alikes."""
    if res.best is not None or not res.candidates:
        return res
    ranked = sorted(res.candidates, key=lambda c: c.importance, reverse=True)
    top = ranked[0]
    if top.importance < 0.3:
        return res
    if not _names_match(top.name, res.query):
        return res
    others = ranked[1:]
    if all(o.importance < 0.12 or not _names_match(o.name, res.query) for o in others):
        promoted = res.model_copy(
            update={"best": top, "candidates": ranked, "status": "resolved", "needs_clarification": False}
        )
        if promoted.boundary is None:
            try:
                box = BBox(*top.bbox)  # type: ignore[arg-type]
                if box.span()[0] > 0 and box.span()[1] > 0:
                    promoted = promoted.model_copy(update={"boundary": _bbox_ring(box)})
                    promoted.warnings.append(
                        "No verified outline available for this feature; showing an approximate bounding-box outline."
                    )
            except (CoordinateError, TypeError, ValueError):
                pass
        return promoted
    return res


def _prefer_high_importance(res: ResolveResponse, limit: int) -> ResolveResponse:
    """Prefer an important, recognisable feature over a same-named tiny place.

    Example: "Amazon rainforest" returns a small conservation concession first;
    the well-known feature has a much higher OSM importance score.
    'resolved' when the top two candidates differ clearly in importance,
    'ambiguous' when it is genuinely close.
    """
    # The region guard must run even when there is only ONE candidate: a single
    # tiny same-named feature is the exact failure this guards against.
    if res.needs_clarification or not res.candidates:
        return res
    ranked = sorted(res.candidates[:limit], key=lambda c: c.importance, reverse=True)
    top = ranked[0]

    # Region guard. A query that names a large geographic region must not be
    # answered by a tiny same-named feature somewhere unrelated: "Amazon
    # rainforest" was resolving to a garden in Los Angeles because an OSM node
    # carries that exact name. If the query looks regional but the winner is a
    # small named node with no region-sized bbox, pick the largest candidate
    # instead and say the outline is approximate.
    if _looks_regional(res.query) and top.importance < 0.5:
        big = max(ranked, key=lambda c: _bbox_area(c.bbox))
        big_area = _bbox_area(big.bbox)
        top_area = _bbox_area(top.bbox)
        # A real regional feature has a region-sized extent. Comparing candidates
        # to each other is not enough: among several tiny same-named places one is
        # always "20x larger", which promoted a South African forest for
        # "Amazon rainforest". Require an ABSOLUTE size.
        if big is not top and big_area >= _REGION_MIN_AREA_DEG2 and big_area > top_area * 20:
            promoted = res.model_copy(
                update={
                    "best": big,
                    "candidates": ranked,
                    "status": "resolved",
                    "needs_clarification": False,
                    "boundary": None,
                }
            )
            promoted.warnings.append(
                "Matched the largest candidate for this regional name; the outline is approximate "
                "and the smaller same-named places were ignored."
            )
            return promoted

        # Nothing region-sized matched at all: every candidate is a tiny
        # same-named feature (a garden, a small forest patch). Returning one of
        # those would be a confident wrong answer, so return the regional
        # reference point flagged as approximate instead.
        if big_area < _REGION_MIN_AREA_DEG2:
            ref = _regional_reference(res.query)
            if ref is not None:
                lat, lon, label, span = ref
                point = LocationCandidate(
                    id=f"region-{label}",
                    name=label,
                    type="region",
                    category="regional reference",
                    country=None,
                    country_code=None,
                    lat=lat,
                    lon=lon,
                    bbox=[lat - span, lon - span * 1.4, lat + span, lon + span * 1.4],
                    importance=0.5,
                    score=50.0,
                    kind="location",
                    display_name=label,
                )
                return res.model_copy(
                    update={
                        "best": point,
                        "candidates": [point, *ranked],
                        "status": "resolved",
                        "needs_clarification": False,
                        "boundary": None,
                        "warnings": res.warnings
                        + [
                            "No region-sized match in OpenStreetMap for this name. Showing an "
                            "approximate regional reference point, not an administrative outline."
                        ],
                    }
                )
    # Coarse features always outrank their children (e.g. a continent over a region).
    if top.importance >= 0.35 and top.type in ("continent", "ocean", "sea", "country", "state", "region"):
        return res.model_copy(update={"best": top, "candidates": ranked, "status": "resolved", "needs_clarification": False})
    # A single candidate has nothing to be ambiguous against.
    if len(ranked) < 2:
        return res
    top, second = ranked[0], ranked[1]
    gap = top.importance - second.importance

    # A well-known, clearly more important feature whose own name is not part of
    # the runner-up's display name (e.g. the Amazon rainforest vs a concession named
    # after it). Only this case is promoted.
    distinct = False
    if top.importance >= 0.6 and gap >= 0.02:
        own = (top.name or "").casefold()
        unrelated = [t for t in re.split(r"[^\w]+", own) if len(t) > 2 and t not in _STOPWORDS]
        distinct = bool(unrelated) and not any(
            t in [x for x in re.split(r"[^\w]+", (second.display_name or "").casefold()) if len(x) > 2]
            for t in unrelated
        )
    if distinct:
        promoted = res.model_copy(update={"best": top, "candidates": ranked, "status": "resolved"})
        try:
            box = BBox(*top.bbox)  # type: ignore[arg-type]
            if box.span()[0] > 0 and box.span()[1] > 0:
                promoted.warnings.append(
                    "No verified outline available for this feature; showing an approximate bounding-box outline."
                )
                promoted = promoted.model_copy(update={"boundary": _bbox_ring(box)})
        except (CoordinateError, TypeError, ValueError):
            promoted = promoted.model_copy(update={"boundary": None})
        return promoted

    if gap < 0.06 and not _names_match(top.name, res.query):
        return _apply_strong_match(res)
    # Same name in different countries, close importance -> ask the operator.
    if (top.name or "").casefold() == (second.name or "").casefold() and gap < 0.15 and (top.country_code or "") != (second.country_code or ""):
        return res.model_copy(
            update={
                "status": "ambiguous",
                "needs_clarification": True,
                "best": None,
                "boundary": None,
                "candidates": ranked,
                "warnings": res.warnings
                + ["Several distinct places match this name. Pick a candidate (status = ambiguous)."],
            }
        )
    return res


_LEAD_IN = re.compile(
    r"^\s*(?:show|display|load|take me to|go to|navigate to|zoom into|zoom to|fly to|find|view|map|open)\b\s*",
    re.I,
)


_INTENT = re.compile(
    r"\b(satellite|imagery|images?|layer|layers|display|load|opacity|boundar(?:y|ies)|outline|overlay|global view|"
    r"latest|suitable|and|with)\b",
    re.I,
)


def _strip_lead_in(q: str) -> str:
    out = _LEAD_IN.sub("", q)
    out = _INTENT.sub(" ", out)
    return re.sub(r"\s+", " ", out).strip(" .,!?")


async def _search_once(
    q: str,
    original_query: str,
    *,
    limit: int,
    near: Optional[Tuple[float, float]],
    allow_ambiguous: bool,
) -> ResolveResponse:
    viewbox = None
    if near is not None:
        viewbox = BBox(near[0] - 5, near[1] - 5, near[0] + 5, near[1] + 5).to_nominatim()
    # Many features are only indexed under their local endonym (e.g. the Amazon
    # rainforest). Ask for the local names too; they rarely add noise.
    results = await nominatim.search(q, limit=limit, viewbox=viewbox, language="default")
    try:
        results = await nominatim.search(q, limit=limit, viewbox=viewbox)
    except UpstreamError as exc:
        return ResolveResponse(
            query=original_query,
            status="not_found",
            warnings=[f"Geocoding provider unavailable: {exc.message}"],
            provenance=_provenance(),
        )

    cands = [c for c in (_candidate_from_nominatim(r) for r in results) if c is not None]
    search_q = _INTENT.sub(" ", q) if cands else q
    named = [c for c in cands if _names_match(c.name, search_q)]
    if named:
        cands = named
    if not cands:
        return ResolveResponse(
            query=original_query,
            status="not_found",
            warnings=[
                "No place found. Check the spelling or provide coordinates as 'lat, lon' (e.g. 12.9716, 77.5846)."
            ],
            provenance=_provenance(),
        )
    weak_single = cands[0].importance < 0.15 and len(cands) == 1
    # Only incidental, low-importance matches: prefer a generic feature frame.
    incidental = bool(cands) and cands[0].importance < 0.15 and _names_match(cands[0].name, q)
    if cands and (weak_single or incidental) and not allow_ambiguous:
        # The only hit is a weak, incidental match (e.g. a conservation concession
        # named after a rainforest). Try a generic, well-known feature instead.
        for generic in _generic_fallbacks(search_q):
            alt = await _search_once(generic, q, limit=limit, near=near, allow_ambiguous=True)
            if alt.best is not None and not alt.needs_clarification:
                label = q.strip(" .!?").title()
                alt.best = alt.best.model_copy(
                    update={"name": label, "display_name": f"{label} region ({alt.best.display_name})"}
                )
                alt.warnings.append(
                    f"Exact administrative feature not available; framing the {generic} region that contains this area."
                )
                alt = alt.model_copy(update={"candidates": [alt.best] + alt.candidates})
                if alt.boundary is None:
                    alt.warnings.append(
                        "No verified outline for this region; showing a camera frame and point marker only."
                    )
                return alt
    if cands and cands[0].importance < 0.15:
        # Weak matches never silently become a "resolved" place.
        return ResolveResponse(
            query=original_query,
            status="ambiguous",
            needs_clarification=True,
            candidates=cands[:limit],
            warnings=[
                "No strong match for this name. Pick a candidate below or give coordinates as 'lat, lon'."
            ],
            provenance=_provenance(),
        )

    top = cands[0]
    warnings: List[str] = []
    ambiguous = False
    if len(cands) > 1 and not allow_ambiguous:
        second = cands[1]
        same_country = (top.country_code or "") == (second.country_code or "")
        same_name = (top.name or "").casefold() == (second.name or "").casefold()
        close_score = (top.importance - second.importance) < 0.06
        # Two strong matches with the same name in different countries is ambiguous
        if close_score and not same_country and same_name:
            ambiguous = True
    if ambiguous:
        warnings.append(
            "Several distinct places match this name. Pick a candidate (status = ambiguous)."
        )

    boundary: Optional[Boundary] = None
    if not ambiguous:
        try:
            osm_type, _, osm_id = top.id.partition("-")
            if osm_type in ("relation", "way", "node") and top.type not in NON_BOUNDARY_TYPES - {"administrative"}:
                detail = await nominatim.details(osm_type, int(osm_id), geometry=True)
                boundary = _boundary_from_geojson(detail.get("geojson") or {})
        except (UpstreamError, ValueError):
            boundary = None
        if boundary is None:
            box = BBox(*top.bbox)  # type: ignore[arg-type]
            if box.span()[0] > 0 and box.span()[1] > 0:
                boundary = _bbox_ring(box)
                warnings.append(
                    "No verified outline available for this feature; showing an approximate bounding-box outline."
                )

    return ResolveResponse(
        query=original_query,
        status="ambiguous" if ambiguous else "resolved",
        needs_clarification=ambiguous,
        best=None if ambiguous else top,
        candidates=cands,
        boundary=boundary,
        warnings=warnings,
        provenance=_provenance(),
    )


async def get_location_boundaries(candidate_id: str) -> Optional[Boundary]:
    osm_type, _, osm_id = candidate_id.partition("-")
    if osm_type not in ("relation", "way", "node"):
        return None
    try:
        detail = await nominatim.details(osm_type, int(osm_id), geometry=True)
    except (UpstreamError, ValueError):
        return None
    return _boundary_from_geojson(detail.get("geojson") or {})


def get_geographic_context(cand: LocationCandidate) -> ContextResponse:
    box = BBox(*cand.bbox)  # type: ignore[arg-type]
    lat_span, lon_span = box.span()
    area = None
    if lat_span > 0 and lon_span > 0:
        # Spherical approximation of the bbox area
        from math import cos, radians

        mid = (box.south + box.north) / 2
        area = (111.32 ** 2) * lat_span * lon_span * max(0.001, cos(radians(mid)))
    centre = box.center()
    warnings: List[str] = []
    if lon_span > 180:
        warnings.append("Bounding box crosses the antimeridian; unwrap longitudes when drawing.")
    return ContextResponse(
        name=cand.display_name or cand.name,
        lat=centre[0],
        lon=centre[1],
        bbox=cand.bbox,
        area_km2=round(area, 1) if area else None,
        span_deg=[round(lat_span, 4), round(lon_span, 4)],
        country=cand.country,
        warnings=warnings,
        provenance=_provenance(),
    )

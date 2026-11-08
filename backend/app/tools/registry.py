"""Tool registry: typed inputs, permission level, timeout, honest error format.

Tools never execute shell commands or arbitrary code. Each tool declares a JSON
schema (used to build the model's function declarations) and a handler that
receives the task context so it can emit UI actions through the registry.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from ..events.eonet import eonet, filter_visible
from ..events.firms import firms
from ..geo.coords import BBox, CoordinateError, bbox_from_pairs
from ..geo.location_service import get_geographic_context, resolve_location
from ..http_client import UpstreamError
from ..imagery.gibs import gibs
from ..models import Freshness, LocationCandidate, Provenance, utcnow

log = logging.getLogger("saturn.tools")


class ToolError(Exception):
    """A clean, user-reportable tool failure."""

    def __init__(self, message: str, *, kind: str = "tool_error", retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.kind = kind
        self.retryable = retryable

    def as_dict(self) -> Dict[str, Any]:
        return {"ok": False, "error": {"kind": self.kind, "message": self.message, "retryable": self.retryable}}


@dataclass
class TaskContext:
    task_id: str
    emit: Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]
    state: Dict[str, Any] = field(default_factory=dict)
    last_location: Optional[Dict[str, Any]] = None
    last_layer: Optional[Dict[str, Any]] = None
    last_date: Optional[str] = None
    tool_calls: int = 0


@dataclass
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]
    handler: Callable[[TaskContext, Dict[str, Any]], Awaitable[Dict[str, Any]]]
    permission: str = "read"  # read | ui_write | privileged
    timeout_s: float = 25.0


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def names(self) -> List[str]:
        return list(self._tools)

    def all(self) -> List[Tool]:
        return list(self._tools.values())

    async def call(self, ctx: TaskContext, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        tool = self.get(name)
        if tool is None:
            raise ToolError(f"Unknown tool '{name}'.", kind="unknown_tool")
        started = time.monotonic()
        try:
            result = await asyncio.wait_for(tool.handler(ctx, args or {}), timeout=tool.timeout_s)
        except asyncio.TimeoutError:
            raise ToolError(f"Tool '{name}' timed out after {tool.timeout_s:.0f}s.", kind="timeout", retryable=True)
        except ToolError:
            raise
        except UpstreamError as exc:
            raise ToolError(f"{exc.provider}: {exc.message}", kind="upstream_error", retryable=True)
        except CoordinateError as exc:
            raise ToolError(f"Invalid coordinates: {exc}", kind="invalid_argument")
        except (KeyError, TypeError, ValueError) as exc:
            raise ToolError(f"Invalid arguments for '{name}': {exc}", kind="invalid_argument")
        log.info(
            "tool.call",
            extra={"extra_fields": {"tool": name, "ms": int((time.monotonic() - started) * 1000), "keys": list((args or {}).keys())}},
        )
        ctx.tool_calls += 1
        return result


registry = ToolRegistry()


# ───────────────────────────── helpers ──────────────────────────────
AGENT_PROV = {
    "provider": "S.A.T.U.R.N. agent",
    "product": "tool trace",
}


async def _emit(ctx: TaskContext, action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    ack = await ctx.emit(action, args)
    if ack.get("status") not in ("executed", "accepted"):
        raise ToolError(f"UI action '{action}' failed: {ack.get('error') or 'no acknowledgement'}", kind="ui_rejected")
    return ack


async def _ui_only(ctx: TaskContext, action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """A tool that exists purely to drive one UI action."""
    ack = await _emit(ctx, action, args)
    return {"ok": True, "action": action, "result": ack.get("result")}


def _candidate_brief(c: LocationCandidate) -> Dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "display_name": c.display_name,
        "type": c.type,
        "country": c.country,
        "lat": c.lat,
        "lon": c.lon,
        "bbox": c.bbox,
        "kind": c.kind,
    }


def _parse_bbox(args: Dict[str, Any]) -> Optional[BBox]:
    if "bbox" in args and args["bbox"]:
        return bbox_from_pairs(raw=args["bbox"])
    if args.get("south") is not None and args.get("north") is not None:
        return bbox_from_pairs(
            raw=[args["south"], args.get("west", -180), args["north"], args.get("east", 180)]
        )
    return None


# ───────────────────────────── geo tools ────────────────────────────
async def _resolve_location(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    query = str(args.get("query", "")).strip()
    res = await resolve_location(query, allow_ambiguous=bool(args.get("allow_ambiguous", False)))
    out = res.model_dump(mode="json")
    if res.best is not None:
        ctx.last_location = _candidate_brief(res.best)
        ctx.state["last_location"] = ctx.last_location
        ctx.state["last_boundary"] = res.boundary.model_dump(mode="json") if res.boundary else None
    return out


def altitude_for_span(lat_span: float, lon_span: float) -> float:
    """Camera altitude (km) that frames a bbox; same curve as the frontend."""
    span = max(lat_span * 1.5, abs(lon_span) * 1.1, 0.004)
    arc = min(170.0, span * 1.6)
    alt = 6371.0 * (1.0 / math.cos(math.radians(arc / 2)) - 1.0)
    return round(max(420.0, min(28000.0, alt)), 1)


async def _fly_to_location(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    query = str(args.get("query", "")).strip()
    res = await resolve_location(query)
    if res.status != "resolved" or res.best is None:
        return {
            "ok": False,
            "status": res.status,
            "candidates": [_candidate_brief(c) for c in res.candidates[:5]],
            "warnings": res.warnings,
        }
    best = res.best
    lat_span, lon_span = BBox(*best.bbox).span()  # type: ignore[arg-type]
    altitude = altitude_for_span(lat_span, lon_span)
    if altitude < 2000 and max(lat_span, lon_span) > 2:
        altitude = 2000.0
    await _emit(ctx, "highlight_location", {
        "name": best.name,
        "lat": best.lat,
        "lon": best.lon,
        "bbox": best.bbox,
        "geojson": res.boundary.model_dump(mode="json") if res.boundary and res.boundary.is_exact else None,
    })
    await _emit(ctx, "navigate_globe", {"lat": best.lat, "lon": best.lon, "altitude_km": round(altitude, 1)})
    ctx.last_location = _candidate_brief(best)
    ctx.state["last_location"] = ctx.last_location
    ctx.state["last_boundary"] = res.boundary.model_dump(mode="json") if res.boundary else None
    ctx.state["flew_to"] = best.id
    return {"ok": True, "location": _candidate_brief(best), "camera_altitude_km": round(altitude, 1), "warnings": res.warnings}


async def _get_coordinates(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    res = await resolve_location(str(args.get("query", "")))
    if res.best is None:
        return {"ok": False, "status": res.status, "candidates": [_candidate_brief(c) for c in res.candidates[:5]]}
    b = res.best
    return {"ok": True, "name": b.name, "lat": b.lat, "lon": b.lon, "type": b.type, "country": b.country}


async def _get_bounding_box(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    res = await resolve_location(str(args.get("query", "")))
    if res.best is None:
        return {"ok": False, "status": res.status}
    return {"ok": True, "name": res.best.name, "bbox": res.best.bbox, "order": "south,west,north,east"}


async def _get_boundaries(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    res = await resolve_location(str(args.get("query", "")))
    if res.best is None:
        return {"ok": False, "status": res.status}
    return {
        "ok": True,
        "name": res.best.name,
        "boundary": res.boundary.model_dump(mode="json") if res.boundary else None,
        "exact": bool(res.boundary and res.boundary.is_exact),
        "warnings": res.warnings,
    }


async def _get_context(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    res = await resolve_location(str(args.get("query", "")))
    if res.best is None:
        return {"ok": False, "status": res.status}
    return get_geographic_context(res.best).model_dump(mode="json")


# ───────────────────────────── imagery tools ────────────────────────
async def _discover_layers(ctx: TaskContext, _args: Dict[str, Any]) -> Dict[str, Any]:
    layers = await gibs.discover_layers()
    return {"ok": True, "layers": [l.model_dump(mode="json") for l in layers]}


async def _layer_metadata(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    layer = await gibs.get_layer(str(args.get("layer_id", "")))
    return {"ok": True, "layer": layer.model_dump(mode="json")}


async def _available_dates(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    layer = await gibs.get_layer(str(args.get("layer_id")))
    days = int(args.get("days", 14))
    dates, latest = gibs.available_dates(layer, days=max(1, min(60, days)))
    return {"ok": True, "layer_id": layer.id, "latest": latest.date, "count": len(dates), "dates": [d.date for d in dates]}


async def _show_imagery(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    layer = await gibs.get_layer(str(args.get("layer_id")))
    requested = args.get("date")
    if requested:
        ok, reason = gibs.validate_date(layer, str(requested))
        if not ok:
            latest = gibs.latest_available_date(layer)
            raise ToolError(reason or "Date unavailable.", kind="invalid_argument")
        iso_date = str(requested)
    else:
        iso_date = gibs.latest_available_date(layer).isoformat()
    plan = gibs.build_tile_plan(layer, iso_date)
    # Remember the layer we are leaving so "switch to the previous layer" can work.
    previous = ctx.state.get("last_layer")
    if previous and previous.get("id") != layer.id:
        stack = list(ctx.state.get("layer_history") or [])
        stack.append(previous.get("id"))
        ctx.state["layer_history"] = stack[-10:]
    await _emit(ctx, "set_imagery_layer", {"layer_id": layer.id})
    await _emit(ctx, "set_observation_date", {"date": iso_date})
    ctx.last_layer = layer.model_dump(mode="json")
    ctx.last_date = iso_date
    ctx.state["last_layer"] = ctx.last_layer
    ctx.state["last_date"] = iso_date
    ctx.state["imagery_date"] = iso_date
    return {
        "ok": True,
        "layer": {"id": layer.id, "title": layer.title},
        "date": iso_date,
        "tile_template": plan.tile_template,
        "freshness": plan.provenance.freshness.value,
        "provenance": plan.provenance.model_dump(mode="json"),
        "warnings": plan.warnings,
    }


# ───────────────────────────── events / fires ───────────────────────
def _bounds_from_ctx(ctx: TaskContext) -> BBox:
    loc = ctx.state.get("last_location")
    if loc and loc.get("bbox"):
        return BBox(*loc["bbox"])
    return BBox(-60.0, -15.0, 70.0, 45.0)  # default: wide Europe/Mediterranean window


async def _get_fires(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    box = _parse_bbox(args) or _bounds_from_ctx(ctx)
    res = await firms.fetch(box, days=int(args.get("days", 1)), source=str(args.get("source") or "VIIRS_SNPP_NRT"))
    await _emit(ctx, "toggle_map_overlay", {"overlay": "fires"})
    return res.model_dump(mode="json")


async def _get_fires_for_region(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve a place or region name, then fetch FIRMS detections for its area.

    One call instead of making the model chain resolve -> bbox -> fires by hand,
    which is where "show wildfires around southern Europe" used to stall.
    """
    query = str(args.get("region") or "").strip()
    if not query:
        raise ToolError("region is required.", kind="invalid_argument")

    loc = await resolve_location(query)
    box = None
    label = query
    approximate = True
    if loc.best is not None and loc.best.bbox:
        s, w, n, e = loc.best.bbox  # type: ignore[misc]
        box = [float(s), float(w), float(n), float(e)]
        label = loc.best.name
        approximate = loc.status != "resolved" or bool(loc.warnings)
    if box is None:
        box = _bounds_from_ctx(ctx)
    if box is None:
        return {
            "ok": False,
            "error": {
                "kind": "no_area",
                "message": f"Could not determine an area for '{query}'.",
            },
        }

    days = int(args.get("days", 2))
    res = await firms.fetch(BBox(*[float(v) for v in box]), days=days, source=str(args.get("source") or "VIIRS_SNPP_NRT"))
    payload = res.model_dump(mode="json")

    # Push the detections onto the globe so the data is actually visible, not
    # just described in text.
    detections = [
        {
            "lat": d.lat,
            "lon": d.lon,
            "confidence": getattr(d, "confidence", None),
            "satellite": getattr(d, "satellite", None),
            "acquired": getattr(d, "acquisition_time", None),
        }
        for d in (getattr(res, "detections", None) or [])
        if d.lat is not None and d.lon is not None
    ][:5000]
    if detections:
        await _emit(
            ctx,
            "show_fire_observations",
            {"detections": detections, "region": label},
        )
    else:
        # Nothing detected: say so rather than switching on an empty layer.
        await _emit(ctx, "toggle_map_overlay", {"overlay": "fires"})
    payload["region"] = label
    payload["query"] = query
    payload["area_bbox"] = box
    payload["area_is_approximate"] = approximate
    payload["note"] = (
        "FIRMS thermal-anomaly detections within the search area - these are not "
        "confirmed wildfires, and the area is a bounding box, not a border."
    )
    return payload


async def _get_events(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    box = _parse_bbox(args)
    events = await eonet.list_events(days=int(args.get("days", 30)), status=str(args.get("status", "open")))
    if box is not None:
        events = filter_visible(events, box)
    await _emit(ctx, "toggle_map_overlay", {"overlay": "events"})
    return {
        "ok": True,
        "count": len(events),
        "events": [e.model_dump(mode="json") for e in events[:40]],
        "provenance": Provenance(
            provider="NASA EONET",
            product="Earth Observatory Natural Event Tracker v3",
            retrieval_time=utcnow().isoformat(),
            freshness=Freshness.RECENT_OBSERVATION,
            attribution="NASA EONET",
        ).model_dump(mode="json"),
    }


async def _compare_dates(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    layer_id = str(args.get("layer_id") or (ctx.state.get("last_layer") or {}).get("id") or "MODIS_Terra_CorrectedReflectance_TrueColor")
    layer = await gibs.get_layer(layer_id)
    date_a = str(args.get("date_a") or ctx.state.get("last_date") or gibs.latest_available_date(layer).isoformat())
    if args.get("date_b"):
        date_b = str(args["date_b"])
    else:
        from datetime import date, timedelta

        date_b = (date.fromisoformat(date_a) - timedelta(days=30)).isoformat()
    for d in (date_a, date_b):
        ok, reason = gibs.validate_date(layer, d)
        if not ok:
            return {"ok": False, "error": reason}
    await _emit(ctx, "compare_dates", {"mode": str(args.get("mode", "swipe")), "date_a": date_a, "date_b": date_b})
    return {
        "ok": True,
        "layer": layer.id,
        "date_a": date_a,
        "date_b": date_b,
        "note": "Side-by-side/swipe of two real daily composites. No quantitative change detection is performed.",
    }


async def _report_uncertainty(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
    topic = str(args.get("topic", "the current dataset"))
    return {
        "ok": True,
        "topic": topic,
        "limitations": [
            "NASA GIBS layers used here are daily composites, not single satellite passes; small features below ~250-500 m cannot be resolved.",
            "Cloud cover can hide the surface on true-colour days.",
            "Nominal ingest lag is about one day; imagery is never 'live'.",
            "FIRMS detections are thermal anomalies and are not confirmed wildfires.",
            "EONET event positions are provided by reporting agencies with their own latency.",
            "Place outlines come from OpenStreetMap; bbox outlines are approximate.",
        ],
    }


# ───────────────────────────── registration ─────────────────────────
def _obj(props: Dict[str, Any], required: List[str] | None = None) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or []}


_STR = {"type": "string"}
_NUM = {"type": "number"}
_INT = {"type": "integer"}


def build_registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(Tool("resolve_location", "Resolve any place name or 'lat, lon' to ranked candidates with bbox and provenance.", _obj({"query": _STR}, ["query"]), _resolve_location))
    reg.register(Tool("get_location_coordinates", "Return the coordinates of a resolved place.", _obj({"query": _STR}, ["query"]), _get_coordinates))
    reg.register(Tool("get_location_bounding_box", "Return south,west,north,east bbox for a place.", _obj({"query": _STR}, ["query"]), _get_bounding_box))
    reg.register(Tool("get_location_boundaries", "Return a real boundary if the provider has one; otherwise say it is approximate.", _obj({"query": _STR}, ["query"]), _get_boundaries))
    reg.register(Tool("get_geographic_context", "Area, span and country context for a place.", _obj({"query": _STR}, ["query"]), _get_context))
    reg.register(Tool("fly_to_location", "Resolve a place, draw its outline and fly the globe to it (emits UI actions).", _obj({"query": _STR}, ["query"]), _fly_to_location, permission="ui_write"))
    reg.register(Tool("discover_imagery_layers", "List the verified NASA GIBS imagery layers.", _obj({}), _discover_layers))
    reg.register(Tool("get_layer_metadata", "Metadata for one GIBS layer.", _obj({"layer_id": _STR}, ["layer_id"]), _layer_metadata))
    reg.register(Tool("get_available_observation_dates", "Available observation dates for a layer (latest first).", _obj({"layer_id": _STR, "days": _INT}, ["layer_id"]), _available_dates))
    reg.register(
        Tool(
            "show_satellite_imagery",
            "Load a real NASA GIBS layer on the globe for a date (defaults to the latest composite). Emits UI actions and waits for acknowledgement.",
            _obj({"layer_id": _STR, "date": _STR}, ["layer_id"]),
            _show_imagery,
            permission="ui_write",
            timeout_s=40.0,
        )
    )
    reg.register(Tool("get_fire_observations", "NASA FIRMS thermal anomalies for bounds/time window (needs FIRMS key).", _obj({"bbox": {"type": "array", "items": _NUM}, "days": _INT, "source": _STR}), _get_fires))
    reg.register(
        Tool(
            "get_fires_for_region",
            "Fetch NASA FIRMS thermal-anomaly detections around a named place or region (e.g. 'southern Europe', 'South Korea'). Resolves the area, then queries FIRMS. Use this for 'show wildfires around X'.",
            _obj({"region": _STR, "days": _INT, "source": _STR}, ["region"]),
            _get_fires_for_region,
            timeout_s=40.0,
        )
    )
    reg.register(Tool("get_earth_observation_data", "NASA EONET open natural events for the last N days, optionally filtered by bounds.", _obj({"bbox": {"type": "array", "items": _NUM}, "days": _INT, "status": _STR}), _get_events))
    reg.register(Tool("compare_imagery_dates", "Open a split/swipe comparison of two real tile dates.", _obj({"layer_id": _STR, "date_a": _STR, "date_b": _STR, "mode": _STR}), _compare_dates, permission="ui_write"))
    reg.register(Tool("report_data_uncertainty", "Honest limitations of the currently used data.", _obj({"topic": _STR}), _report_uncertainty))

    # UI actions exposed as tools: the backend validates each one, pushes it over
    # SSE and waits for the browser ACK before the model may claim success.
    async def _restore(ctx: TaskContext, _args: Dict[str, Any]) -> Dict[str, Any]:
        return await _ui_only(ctx, "restore_global_view", {})

    async def _opacity(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
        return await _ui_only(ctx, "set_layer_opacity", {"value": float(args["value"])})

    async def _overlay(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
        return await _ui_only(ctx, "toggle_map_overlay", {"overlay": str(args["overlay"])})

    async def _playback(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
        return await _ui_only(ctx, "start_timeline_playback", {"playing": bool(args.get("playing", True))})

    async def _region(ctx: TaskContext, args: Dict[str, Any]) -> Dict[str, Any]:
        return await _ui_only(ctx, "select_region_card", {"index": int(args["index"])})

    async def _clear(ctx: TaskContext, _args: Dict[str, Any]) -> Dict[str, Any]:
        return await _ui_only(ctx, "clear_all", {})

    reg.register(Tool("restore_global_view", "Return the globe to the default global view.", _obj({}), _restore, permission="ui_write"))
    reg.register(Tool("set_layer_opacity", "Set imagery opacity 0..1.", _obj({"value": _NUM}, ["value"]), _opacity, permission="ui_write"))
    reg.register(Tool("toggle_map_overlay", "Toggle a map overlay.", _obj({"overlay": _STR}, ["overlay"]), _overlay, permission="ui_write"))
    reg.register(Tool("start_timeline_playback", "Start or pause date-sequence playback.", _obj({"playing": {"type": "boolean"}}), _playback, permission="ui_write"))
    reg.register(Tool("select_region_card", "Select a saved region card (0..3) and fly to it.", _obj({"index": _INT}, ["index"]), _region, permission="ui_write"))
    reg.register(Tool("clear_all", "Reset layers, overlays and selection.", _obj({}), _clear, permission="ui_write"))

    async def _previous_layer(ctx: TaskContext, _args: Dict[str, Any]) -> Dict[str, Any]:
        """Re-select the previously loaded imagery layer.

        Honest behaviour: if no layer has been loaded in this session there is
        nothing to go back to, and the tool says so rather than guessing.
        """
        stack = list(ctx.state.get("layer_history") or [])
        if not stack:
            return {
                "ok": False,
                "error": {
                    "kind": "no_history",
                    "message": "No previous layer in this session yet.",
                },
            }
        target = stack.pop()
        ctx.state["layer_history"] = stack
        result = await _show_imagery(ctx, {"layer_id": target})
        return {**result, "restored_previous_layer": target}

    reg.register(
        Tool(
            "switch_to_previous_layer",
            "Go back to the imagery layer that was displayed before the current one.",
            _obj({}),
            _previous_layer,
            permission="ui_write",
            timeout_s=40.0,
        )
    )
    return reg


tool_registry = build_registry()


def tools_json() -> str:
    return json.dumps([{"name": t.name, "description": t.description, "parameters": t.parameters} for t in tool_registry.all()], indent=2)

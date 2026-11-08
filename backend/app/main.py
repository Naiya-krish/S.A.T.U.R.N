"""S.A.T.U.R.N. FastAPI application.

Routes
  GET  /api/health                 liveness + config summary (no secrets)
  GET  /api/ready                  readiness of providers / model
  GET  /api/geo/resolve            location resolution (Nominatim)
  GET  /api/geo/context            geographic context
  GET  /api/imagery/layers         verified GIBS layers
  GET  /api/imagery/layer/{id}     layer metadata
  GET  /api/imagery/dates          available dates
  POST /api/imagery/plan           tile plan (validates date)
  GET  /api/events                 NASA EONET
  POST /api/fires                  NASA FIRMS
  POST /api/agent/command          start a task (returns task id)
  GET  /api/tasks/{id}/events      SSE progress + UI actions
  POST /api/tasks/{id}/cancel
  POST /api/ui-actions/{id}/ack    browser acknowledgement
  GET  /api/ui-actions/spec        typed action schema
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .agent.orchestrator import AgentOrchestrator
from .config import get_settings
from .events.eonet import eonet
from .events.firms import firms
from .geo.coords import BBox, CoordinateError
from .geo.location_service import get_geographic_context, resolve_location
from .http_client import UpstreamError, close_client
from .imagery.gibs import gibs
from .logging_setup import configure_logging, log_event, new_request_id, request_id_ctx
from .models import (
    AgentCommandRequest,
    AgentCommandResponse,
    FireResponse,
    LayerListResponse,
    Provenance,
    Freshness,
    UIActionAck,
    utcnow,
)
from .tasks import TaskCancelled, task_bus
from .ui_actions.registry import ACTION_SPECS, validate_action_args

settings = get_settings()
configure_logging(settings.log_level)
log = logging.getLogger("saturn.api")
STARTED_AT = time.time()

# Strong references for background agent runs (see agent_command).
_BACKGROUND_TASKS: set = set()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log_event(log, "saturn.start", env=settings.saturn_env, agent_mode=settings.agent_mode)

    async def warm():
        try:
            await gibs.discover_layers()
            log_event(log, "gibs.warm", layers=len(await gibs.discover_layers()))
        except UpstreamError as exc:
            log_event(log, "gibs.warm_failed", error=exc.message)

    asyncio.create_task(warm())
    yield
    await close_client()


app = FastAPI(
    title="S.A.T.U.R.N. - Earth Intelligence API",
    version="0.1.0",
    description="Sentient Agentic Terrain & Universe Reconnaissance Network",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or new_request_id()
    started = time.monotonic()
    # The request id must survive into background tasks (the agent runs outside
    # the request scope), so it is set but never reset here.
    request_id_ctx.set(rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    log_event(
        log,
        "http.request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        ms=int((time.monotonic() - started) * 1000),
    )
    return response


@app.exception_handler(UpstreamError)
async def upstream_handler(_request: Request, exc: UpstreamError):
    return JSONResponse(status_code=502 if (exc.status_code or 500) >= 500 else 400, content={"error": exc.message, "provider": exc.provider})


@app.exception_handler(CoordinateError)
async def coord_handler(_request: Request, exc: CoordinateError):
    return JSONResponse(status_code=422, content={"error": str(exc)})


# ───────────────────────────── health ──────────────────────────────
@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "saturn-backend",
        "version": "0.1.0",
        "uptime_s": round(time.time() - STARTED_AT, 1),
        "agent_mode": settings.agent_mode,
        "vertex_model": settings.vertex_model if settings.agent_mode == "vertex" else None,
        "now": utcnow().isoformat(),
    }


@app.get("/api/ready")
async def ready() -> Dict[str, Any]:
    from .agent.model_client import get_model_client

    checks: Dict[str, str] = {}
    try:
        layers = await gibs.discover_layers()
        checks["gibs"] = f"ok ({len(layers)} verified layers)"
    except UpstreamError as exc:
        checks["gibs"] = f"degraded: {exc.message}"
    checks["nominatim"] = "ok (client ready)"
    checks["eonet"] = "ok (client ready)"
    checks["firms"] = "ok (configured)" if firms.configured else "unavailable (FIRMS_MAP_KEY missing)"
    checks["model"] = f"ok ({get_model_client().name})"
    return {"ready": True, "checks": checks, "agent_mode": settings.agent_mode}


# ───────────────────────────── geo ─────────────────────────────────
@app.get("/api/geo/resolve")
async def geo_resolve(q: str, limit: int = 6, lat: Optional[float] = None, lon: Optional[float] = None):
    near = (lat, lon) if lat is not None and lon is not None else None
    res = await resolve_location(q, limit=limit, near=near)
    status = {"resolved": 200, "ambiguous": 200, "not_found": 404, "invalid": 422}[res.status]
    return JSONResponse(status_code=status, content=res.model_dump(mode="json"))


@app.get("/api/geo/context")
async def geo_context(q: str):
    res = await resolve_location(q)
    if res.best is None:
        raise HTTPException(status_code=404, detail={"status": res.status, "warnings": res.warnings})
    return get_geographic_context(res.best).model_dump(mode="json")


# ───────────────────────────── imagery ─────────────────────────────
@app.get("/api/imagery/layers", response_model=LayerListResponse)
async def imagery_layers():
    layers = await gibs.discover_layers()
    return LayerListResponse(
        layers=layers,
        provenance=Provenance(
            provider="NASA GIBS",
            product="WMTS capabilities (curated verified subset)",
            retrieval_time=utcnow().isoformat(),
            freshness=Freshness.RECENT_OBSERVATION,
            attribution="NASA Global Imagery Browse Services (GIBS)",
        ),
    )


@app.get("/api/imagery/layer/{layer_id}")
async def imagery_layer(layer_id: str):
    try:
        layer = await gibs.get_layer(layer_id)
    except UpstreamError as exc:
        raise HTTPException(status_code=404, detail=exc.message)
    return layer.model_dump(mode="json")


@app.get("/api/debug/globe-state")
async def debug_globe_state():
    """Headless snapshot for tooling/tests. The authoritative snapshot is
    inspect_globe_state executed in the browser."""
    return {
        "authoritative": False,
        "note": "Runtime UI state lives in the browser; call inspect_globe_state through the UI action registry.",
        "since": utcnow().isoformat(),
    }


@app.get("/api/imagery/dates")
async def imagery_dates(layer_id: str, days: int = 14):
    try:
        layer = await gibs.get_layer(layer_id)
    except UpstreamError as exc:
        raise HTTPException(status_code=404, detail=exc.message)
    dates, latest = gibs.available_dates(layer, days=max(1, min(60, days)))
    return {"layer_id": layer.id, "latest": latest.date, "dates": [d.model_dump() for d in dates]}


class PlanRequest(BaseModel):
    layer_id: str
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


@app.post("/api/imagery/plan")
async def imagery_plan(req: PlanRequest):
    try:
        layer = await gibs.get_layer(req.layer_id)
        plan = gibs.build_tile_plan(layer, req.date)
    except UpstreamError as exc:
        return JSONResponse(status_code=400 if exc.status_code == 400 else 502, content={"error": exc.message, "provider": exc.provider})
    return plan.model_dump(mode="json")


# ───────────────────────────── events ──────────────────────────────
@app.get("/api/events")
async def events(days: int = 30, status: str = "open", bbox: Optional[str] = None, category: Optional[str] = None):
    box = None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
            box = BBox(*parts)
        except (ValueError, CoordinateError):
            raise HTTPException(status_code=422, detail="bbox must be south,west,north,east")
    evs = await eonet.list_events(days=days, status=status, bbox=box, category=category)
    return {"count": len(evs), "events": [e.model_dump(mode="json") for e in evs]}


class FireRequest(BaseModel):
    bbox: List[float]
    days: int = 1
    source: str = "VIIRS_SNPP_NRT"


@app.post("/api/fires", response_model=FireResponse)
async def fires(req: FireRequest):
    try:
        box = BBox(*req.bbox)  # type: ignore[arg-type]
    except (CoordinateError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid bbox: {exc}")
    try:
        return await firms.fetch(box, days=req.days, source=req.source)
    except UpstreamError as exc:
        raise HTTPException(status_code=502, detail=exc.message)


# ───────────────────────────── UI actions ──────────────────────────
@app.get("/api/ui-actions/spec")
async def action_spec():
    return {"actions": [s.model_dump(mode="json") for s in ACTION_SPECS]}


@app.post("/api/ui-actions/validate")
async def action_validate(payload: Dict[str, Any]):
    action_type = str(payload.get("type", ""))
    return validate_action_args(action_type, payload.get("args") or {}).model_dump()


@app.post("/api/ui-actions/{action_id}/ack")
async def action_ack(action_id: str, ack: UIActionAck):
    if ack.action_id != action_id:
        raise HTTPException(status_code=400, detail="action_id mismatch")
    # find the task that owns this action
    task_id = next((t.id for t in task_bus.tasks.values() if action_id in t.acks), None)
    if not task_id or not task_bus.acknowledge(task_id, ack):
        raise HTTPException(status_code=404, detail="Unknown action or task")
    return {"ok": True}


# ───────────────────────────── agent ───────────────────────────────
@app.post("/api/agent/command", response_model=AgentCommandResponse)
async def agent_command(req: AgentCommandRequest):
    task = task_bus.create(req.text.strip(), mode=req.mode, ui_state=req.ui_state)
    orchestrator = AgentOrchestrator(task_bus)

    # Run the orchestrator in the BACKGROUND. Awaiting it here blocked the HTTP
    # response for the whole agent run (measured 197 s on the Vertex path), so
    # the client never got its task id and SSE could not attach in time.
    async def _run() -> None:
        try:
            await orchestrator.start(task)
        except TaskCancelled:
            pass
        except Exception as exc:  # noqa: BLE001 - never lose the failure
            message = str(exc) or f"{exc.__class__.__name__} (no message)"
            log_event(log, "agent.crashed", task_id=task.id, error=repr(exc))
            # Publish through the bus so SSE clients actually see the failure.
            # Task has no `status`/`error` attributes to assign here; publish()
            # is the single source of truth for task state.
            if not task.cancelled:
                task_bus.publish(task, "error", {"kind": "internal_error", "message": message[:240]})
                task_bus.publish(task, "status", {"status": "failed"})

    # Keep a strong reference: a bare asyncio.create_task() can be garbage
    # collected mid-flight, which made the task die silently with no actions and
    # no error. The set is module-level so the task survives the request scope.
    bg = asyncio.create_task(_run())
    _BACKGROUND_TASKS.add(bg)
    bg.add_done_callback(_BACKGROUND_TASKS.discard)

    log_event(log, "agent.start", task_id=task.id, mode=req.mode, chars=len(req.text))
    return AgentCommandResponse(task_id=task.id, status=task.status, mode=req.mode)


@app.get("/api/tasks/{task_id}/events")
async def task_events(task_id: str):
    if task_bus.get(task_id) is None:
        raise HTTPException(status_code=404, detail="Unknown task")
    return StreamingResponse(
        task_bus.event_generator(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.get("/api/tasks/{task_id}")
async def task_detail(task_id: str):
    task = task_bus.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Unknown task")
    return task.snapshot()


@app.post("/api/tasks/{task_id}/cancel")
async def task_cancel(task_id: str):
    ok = task_bus.cancel(task_id)
    return {"cancelled": ok}


@app.get("/api/tasks")
async def task_list():
    return {"tasks": task_bus.list_tasks()}


@app.get("/api/agent/config")
async def agent_config():
    return {
        "mode": settings.agent_mode,
        "model": settings.vertex_model if settings.agent_mode == "vertex" else "deterministic-mock",
        "project_configured": bool(settings.google_cloud_project),
        "location": settings.google_cloud_location,
        "limits": {
            "max_tool_calls": settings.agent_max_tool_calls,
            "tool_timeout_s": settings.agent_tool_timeout_s,
            "overall_timeout_s": settings.agent_overall_timeout_s,
        },
        "firms_configured": firms.configured,
    }


# ════════════════════════════ Phase 8: auth & saved data ════════════════════
# These routes are deliberately explicit about which mode they are running in.
# A demo deployment never pretends saved data is private.

from fastapi import Depends  # noqa: E402

from . import auth as auth_mod  # noqa: E402
from . import ratelimit  # noqa: E402
from . import store  # noqa: E402


class SaveRegionRequest(store.SavedRegion):
    pass


class SaveViewRequest(store.SavedView):
    pass


class PrefsRequest(store.Preferences):
    pass


@app.get("/api/auth/config")
async def auth_config():
    """Public: tells the browser which auth mode is active.

    No secrets. The frontend uses this to decide whether to show a sign-in
    button, and to label the demo honestly.
    """
    mode = auth_mod.auth_mode()
    storage = store.storage_mode()

    # The notice must describe what actually happens, including the case where
    # accounts are available but persistence is not: claiming "sign in to save"
    # while writes go to process memory would be dishonest, because the data
    # disappears on restart.
    if mode == "firebase" and storage != "firestore":
        notice = (
            "Accounts are available, but Firestore is not configured on the server, "
            "so saved regions are kept in process memory and are lost on restart."
        )
    else:
        notice = {
            "firebase": "Sign in to save regions, views and preferences.",
            "demo": (
                "Public DEMO mode: no accounts. Saved items are shared and not private, "
                "and may be cleared at any time."
            ),
            "disabled": "Accounts are disabled on this deployment; saving is unavailable.",
        }[mode]

    return {
        "mode": mode,
        "accounts_enabled": mode == "firebase",
        "storage": storage,
        "persistent": storage == "firestore",
        "firebase_project": settings.firebase_project_id or settings.google_cloud_project or None,
        "notice": notice,
    }


@app.get("/api/me")
async def me(identity: auth_mod.Identity = Depends(auth_mod.current_identity)):
    return {
        "uid": identity.uid,
        "email": identity.email,
        "name": identity.name,
        "mode": identity.mode,
        "storage": store.storage_mode(),
    }


def _guard(request: Request, identity: auth_mod.Identity) -> None:
    """Rate limit last, so a 401 never consumes a caller's quota."""
    ratelimit.check(request, identity.uid)


# ── regions ────────────────────────────────────────────────────────────────
@app.get("/api/me/regions")
async def list_regions(
    request: Request, identity: auth_mod.Identity = Depends(auth_mod.current_identity)
):
    _guard(request, identity)
    return {
        "regions": store.list_documents(identity.uid, "regions"),
        "mode": identity.mode,
        "storage": store.storage_mode(),
    }


@app.post("/api/me/regions", status_code=201)
async def save_region(
    payload: SaveRegionRequest,
    request: Request,
    identity: auth_mod.Identity = Depends(auth_mod.current_identity),
):
    _guard(request, identity)
    if not (-90 <= payload.lat <= 90) or not (-180 <= payload.lon <= 180):
        raise HTTPException(status_code=422, detail="lat/lon out of range.")
    doc = store.put_document(identity.uid, "regions", payload)
    return {"region": doc, "mode": identity.mode, "storage": store.storage_mode()}


@app.delete("/api/me/regions/{region_id}")
async def delete_region(
    region_id: str,
    request: Request,
    identity: auth_mod.Identity = Depends(auth_mod.current_identity),
):
    _guard(request, identity)
    ok = store.delete_document(identity.uid, "regions", region_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Region not found.")
    return {"deleted": region_id}


# ── views ──────────────────────────────────────────────────────────────────
@app.get("/api/me/views")
async def list_views(
    request: Request, identity: auth_mod.Identity = Depends(auth_mod.current_identity)
):
    _guard(request, identity)
    return {"views": store.list_documents(identity.uid, "views"), "storage": store.storage_mode()}


@app.post("/api/me/views", status_code=201)
async def save_view(
    payload: SaveViewRequest,
    request: Request,
    identity: auth_mod.Identity = Depends(auth_mod.current_identity),
):
    _guard(request, identity)
    doc = store.put_document(identity.uid, "views", payload)
    return {"view": doc, "storage": store.storage_mode()}


@app.delete("/api/me/views/{view_id}")
async def delete_view(
    view_id: str,
    request: Request,
    identity: auth_mod.Identity = Depends(auth_mod.current_identity),
):
    _guard(request, identity)
    if not store.delete_document(identity.uid, "views", view_id):
        raise HTTPException(status_code=404, detail="View not found.")
    return {"deleted": view_id}


# ── preferences ────────────────────────────────────────────────────────────
@app.get("/api/me/prefs")
async def get_prefs(
    request: Request, identity: auth_mod.Identity = Depends(auth_mod.current_identity)
):
    _guard(request, identity)
    doc = store.get_document(identity.uid, "prefs", "prefs")
    return {"prefs": doc or store.Preferences().model_dump(), "storage": store.storage_mode()}


@app.put("/api/me/prefs")
async def put_prefs(
    payload: PrefsRequest,
    request: Request,
    identity: auth_mod.Identity = Depends(auth_mod.current_identity),
):
    _guard(request, identity)
    payload.id = "prefs"
    doc = store.put_document(identity.uid, "prefs", payload)
    return {"prefs": doc, "storage": store.storage_mode()}


@app.delete("/api/me/data")
async def delete_my_data(
    request: Request, identity: auth_mod.Identity = Depends(auth_mod.current_identity)
):
    """Right-to-erasure: remove every saved document for the caller."""
    _guard(request, identity)
    removed = store.clear_user(identity.uid)
    return {"deleted_documents": removed}

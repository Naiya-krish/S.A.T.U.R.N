"""Tool registry + orchestrator - mocked-model deterministic runs."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from app.agent.model_client import ModelTurn
from app.agent.orchestrator import AgentOrchestrator
from app.geo import location_service
from app.tasks import TaskBus
from app.tools.registry import ToolError, TaskContext, tool_registry

SEOUL = {
    "place_id": 3,
    "osm_type": "relation",
    "osm_id": 2297418,
    "lat": "37.5665",
    "lon": "126.9780",
    "name": "Seoul",
    "display_name": "Seoul, South Korea",
    "class": "boundary",
    "type": "administrative",
    "importance": 0.9,
    "boundingbox": ["37.42", "37.59", "126.73", "127.18"],
    "address": {"country": "South Korea", "country_code": "kr"},
}


@pytest.fixture(autouse=True)
def loop(monkeypatch):
    l = asyncio.new_event_loop()
    asyncio.set_event_loop(l)

    async def fake_search(*a, **k):
        return [SEOUL]

    async def fake_details(*a, **k):
        return {}

    async def fake_reverse(*a, **k):
        return {}

    monkeypatch.setattr(location_service.nominatim, "search", fake_search)
    monkeypatch.setattr(location_service.nominatim, "details", fake_details)
    monkeypatch.setattr(location_service.nominatim, "reverse", fake_reverse)
    yield l
    l.close()


def ctx_with_actions(emitted: List[Dict[str, Any]]) -> TaskContext:
    async def emit(action: str, args: Dict[str, Any]):
        emitted.append({"type": action, "args": args})
        return {"action_id": f"a{len(emitted)}", "status": "executed", "result": {}}

    return TaskContext(task_id="t1", emit=emit)


def test_registry_tools_exist():
    names = set(tool_registry.names())
    required = {
        "resolve_location",
        "get_location_coordinates",
        "get_location_bounding_box",
        "get_location_boundaries",
        "get_geographic_context",
        "discover_imagery_layers",
        "get_layer_metadata",
        "get_available_observation_dates",
        "show_satellite_imagery",
        "get_fire_observations",
        "get_earth_observation_data",
        "compare_imagery_dates",
        "report_data_uncertainty",
    }
    assert required <= names


def test_unknown_tool_errors_honestly():
    ctx = ctx_with_actions([])
    with pytest.raises(ToolError) as exc:
        asyncio.get_event_loop().run_until_complete(tool_registry.call(ctx, "launch_missiles", {}))
    assert exc.value.kind == "unknown_tool"


def test_show_imagery_emits_ui_actions():
    emitted: List[Dict[str, Any]] = []
    ctx = ctx_with_actions(emitted)
    result = asyncio.get_event_loop().run_until_complete(
        tool_registry.call(ctx, "show_satellite_imagery", {"layer_id": "MODIS_Terra_CorrectedReflectance_TrueColor"})
    )
    assert result["ok"] is True
    assert [e["type"] for e in emitted] == ["set_imagery_layer", "set_observation_date"]
    assert result["provenance"]["provider"] == "NASA GIBS"
    assert result["date"]


def test_show_imagery_rejects_future_date(monkeypatch):
    emitted: List[Dict[str, Any]] = []
    ctx = ctx_with_actions(emitted)
    from app.imagery.gibs import gibs as gibs_client

    monkeypatch.setattr(gibs_client, "_layers_cache", None)
    with pytest.raises(ToolError) as exc:
        asyncio.get_event_loop().run_until_complete(
            tool_registry.call(
                ctx, "show_satellite_imagery", {"layer_id": "MODIS_Terra_CorrectedReflectance_TrueColor", "date": "2032-01-01"}
            )
        )
    assert "coverage start" in exc.value.message or "Latest available" in exc.value.message or "has no composite" in exc.value.message
    assert emitted == []


def test_firms_without_key_is_unavailable_not_fake():
    emitted: List[Dict[str, Any]] = []
    ctx = ctx_with_actions(emitted)
    result = asyncio.get_event_loop().run_until_complete(tool_registry.call(ctx, "get_fire_observations", {"bbox": [30, -10, 45, 20]}))
    assert result["count"] == 0
    assert result["provenance"]["freshness"] == "UNAVAILABLE"


class ScriptedModel:
    name = "scripted"

    def __init__(self, turns):
        self.turns = list(turns)

    async def turn(self, history, *, snapshot):
        return self.turns.pop(0) if self.turns else ModelTurn(text="done")


def test_orchestrator_runs_core_workflow(monkeypatch):
    import app.agent.orchestrator as orch

    model = ScriptedModel(
        [
            ModelTurn(tool_calls=[("resolve_location", {"query": "Seoul"})]),
            ModelTurn(tool_calls=[("fly_to_location", {"query": "Seoul"})]),
            ModelTurn(tool_calls=[("show_satellite_imagery", {"layer_id": "MODIS_Terra_CorrectedReflectance_TrueColor"})]),
            ModelTurn(text="Seoul: MODIS Terra true colour for the latest composite (NASA GIBS)."),
        ]
    )
    monkeypatch.setattr(orch, "get_model_client", lambda: model)
    bus = TaskBus()
    task = bus.create("Take me to Seoul and show imagery")
    task.ack_enabled = False  # headless: no browser to acknowledge actions

    async def run_and_wait():
        await orch.AgentOrchestrator(bus).start(task)
        if task.runner:
            await asyncio.wait_for(task.runner, timeout=30)

    asyncio.get_event_loop().run_until_complete(run_and_wait())
    assert task.status.value == "completed"
    kinds = [e.kind for e in task.events]
    assert "ui_action" in kinds and "result" in kinds
    result_event = [e for e in task.events if e.kind == "result"][0]
    assert "NASA GIBS" in result_event.data["text"]


def test_orchestrator_respects_tool_call_limit(monkeypatch):
    import app.agent.orchestrator as orch

    turns = [ModelTurn(tool_calls=[("get_geographic_context", {"query": "Seoul"})]) for _ in range(30)]
    monkeypatch.setattr(orch, "get_model_client", lambda: ScriptedModel(turns))
    bus = TaskBus()
    task = bus.create("loop forever")
    async def run_and_wait():
        await orch.AgentOrchestrator(bus).start(task)
        assert task.runner is not None
        await asyncio.wait_for(task.runner, timeout=30)

    asyncio.get_event_loop().run_until_complete(run_and_wait())
    calls = [e for e in task.events if e.kind == "tool" and e.data.get("phase") == "call"]
    assert len(calls) <= 8


def test_orchestrator_reports_model_failure(monkeypatch):
    import app.agent.orchestrator as orch
    from app.agent.model_client import ModelUnavailable

    class Boom:
        name = "vertex"

        async def turn(self, history, *, snapshot):
            raise ModelUnavailable("Vertex AI quota exceeded.", kind="quota")

    monkeypatch.setattr(orch, "get_model_client", lambda: Boom())
    bus = TaskBus()
    task = bus.create("anything")
    async def run_and_wait():
        await orch.AgentOrchestrator(bus).start(task)
        assert task.runner is not None
        await asyncio.wait_for(task.runner, timeout=30)

    asyncio.get_event_loop().run_until_complete(run_and_wait())
    assert task.status.value == "failed"
    err = [e for e in task.events if e.kind == "error"][0]
    assert err.data["kind"] == "quota"


# ── error classification (regression) ─────────────────────────────────────
def test_rate_limit_is_distinct_from_exhausted_quota():
    """A transient HTTP 429 must not be reported as exhausted quota.

    They need different recovery: a rate limit clears on its own (retry is
    sensible), a hard quota needs a human. Conflating them told the operator
    "quota exceeded" when Vertex had merely rate limited a burst of commands.
    """
    from app.agent.model_client import _is_rate_limited

    assert _is_rate_limited(Exception("429 Too Many Requests"))
    assert _is_rate_limited(Exception("Resource exhausted: rate limit reached"))
    # Quota exhaustion is a different condition.
    assert not _is_rate_limited(Exception("Quota exceeded for quota metric"))


def test_model_unavailable_carries_the_kind():
    from app.agent.model_client import ModelUnavailable

    exc = ModelUnavailable("nope", kind="rate_limited")
    assert exc.kind == "rate_limited"
    assert str(exc) == "nope"

"""API surface tests (TestClient, no network)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["agent_mode"] in ("mock", "vertex")
    assert "X-Request-ID" in r.headers


def test_ready(client):
    r = client.get("/api/ready")
    assert r.status_code == 200
    assert "checks" in r.json()


def test_ui_action_spec(client):
    r = client.get("/api/ui-actions/spec")
    types = {a["type"] for a in r.json()["actions"]}
    assert {"navigate_globe", "set_layer_opacity", "compare_dates"} <= types


def test_validate_endpoint(client):
    r = client.post("/api/ui-actions/validate", json={"type": "set_layer_opacity", "args": {"value": 2}})
    assert r.json()["ok"] is False


def test_imagery_plan_bad_date(client):
    r = client.post(
        "/api/imagery/plan",
        json={"layer_id": "MODIS_Terra_CorrectedReflectance_TrueColor", "date": "1999-01-01"},
    )
    assert r.status_code == 400
    assert "coverage start" in r.json()["error"]


def test_cors_only_dev_origin(client):
    r = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    r2 = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r2.headers


def test_agent_command_returns_task(client):
    r = client.post("/api/agent/command", json={"text": "Go back to the global view."})
    assert r.status_code == 200
    body = r.json()
    assert body["task_id"]
    detail = client.get(f"/api/tasks/{body['task_id']}")
    assert detail.status_code == 200


def test_unknown_task_404(client):
    assert client.get("/api/tasks/nope").status_code == 404
    assert client.post("/api/tasks/nope/cancel").json()["cancelled"] is False

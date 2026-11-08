"""Phase 8 tests: auth modes, per-user isolation, rate limiting.

These run entirely offline. Firestore is replaced by the local store, and
Firebase token verification is exercised through the tri-state mode logic plus a
fake verifier, so no real credentials are needed.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from app import auth as auth_mod
from app import ratelimit, store
from app.config import get_settings


@pytest.fixture()
def client(monkeypatch):
    # Force demo mode for the baseline client: no project, no Firebase.
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "")
    monkeypatch.setenv("SATURN_AUTH", "")
    monkeypatch.setenv("SATURN_FORCE_MOCK_LLM", "1")
    get_settings.cache_clear()
    import app.main as main_mod

    importlib.reload(main_mod)
    auth_mod.reset_cache()
    ratelimit.reset()
    store.reset_local()
    with TestClient(main_mod.app) as c:
        yield c
    get_settings.cache_clear()


@pytest.fixture()
def firebase_client(monkeypatch):
    """A client that behaves as if Firebase is configured, with a fake verifier."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("SATURN_AUTH", "")
    monkeypatch.setenv("FIREBASE_ENABLED", "true")
    get_settings.cache_clear()
    import app.main as main_mod

    importlib.reload(main_mod)
    auth_mod.reset_cache()
    ratelimit.reset()
    store.reset_local()
    with TestClient(main_mod.app) as c:
        yield c
    get_settings.cache_clear()
    auth_mod.reset_cache()


def _patch_verifier(monkeypatch, mapping):
    """Replace the Admin-SDK verification with a token->uid map."""

    def fake(token: str) -> auth_mod.Identity:
        if token not in mapping:
            raise auth_mod.AuthError("Invalid or expired authentication token.")
        return auth_mod.Identity(uid=mapping[token], email=f"{mapping[token]}@example.com")

    monkeypatch.setattr(auth_mod, "_verify_with_admin_sdk", fake)


# ── auth mode reporting ────────────────────────────────────────────────────
def test_demo_mode_is_reported_honestly(client):
    r = client.get("/api/auth/config")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "demo"
    assert body["accounts_enabled"] is False
    assert "not private" in body["notice"].lower()


def test_demo_mode_does_not_claim_accounts(firebase_client):
    r = firebase_client.get("/api/auth/config")
    assert r.json()["mode"] == "firebase"
    assert r.json()["accounts_enabled"] is True


def test_auth_config_does_not_promise_persistence_it_lacks(firebase_client):
    """Accounts without Firestore must not say "sign in to save".

    With no Firestore configured, saved documents live in process memory and are
    lost on restart. Advertising otherwise would be a false promise.
    """
    body = firebase_client.get("/api/auth/config").json()
    assert body["storage"] == "local"
    assert body["persistent"] is False
    assert "not configured" in body["notice"].lower()
    assert "sign in to save" not in body["notice"].lower()


def test_me_identifies_demo_user(client):
    r = client.get("/api/me")
    assert r.status_code == 200
    body = r.json()
    assert body["uid"] == "demo"
    assert body["mode"] == "demo"


def test_demo_rejects_bearer_tokens(client):
    r = client.get("/api/me", headers={"Authorization": "Bearer whatever"})
    assert r.status_code == 401
    assert "DEMO mode" in r.json()["detail"]


def test_firebase_requires_token(firebase_client):
    r = firebase_client.get("/api/me")
    assert r.status_code == 401
    assert "Missing bearer" in r.json()["detail"]


# ── the important one: cross-user isolation ────────────────────────────────
def test_regions_are_isolated_per_user(firebase_client, monkeypatch):
    _patch_verifier(monkeypatch, {"tok-alice": "alice", "tok-bob": "bob"})
    alice = {"Authorization": "Bearer tok-alice"}
    bob = {"Authorization": "Bearer tok-bob"}

    created = firebase_client.post(
        "/api/me/regions",
        json={"name": "South Korea", "lat": 36.5, "lon": 127.8, "note": "alice only"},
        headers=alice,
    )
    assert created.status_code == 201
    region_id = created.json()["region"]["id"]

    # Alice sees her own region.
    alice_list = firebase_client.get("/api/me/regions", headers=alice).json()["regions"]
    assert [r["id"] for r in alice_list] == [region_id]

    # Bob sees nothing, even though he knows the id.
    bob_list = firebase_client.get("/api/me/regions", headers=bob).json()["regions"]
    assert bob_list == []

    # Bob cannot delete Alice's region, and it must survive the attempt.
    denied = firebase_client.delete(f"/api/me/regions/{region_id}", headers=bob)
    assert denied.status_code == 404
    still_there = firebase_client.get("/api/me/regions", headers=alice).json()["regions"]
    assert [r["id"] for r in still_there] == [region_id]


def test_views_and_prefs_are_isolated(firebase_client, monkeypatch):
    _patch_verifier(monkeypatch, {"tok-a": "a", "tok-b": "b"})
    a = {"Authorization": "Bearer tok-a"}
    b = {"Authorization": "Bearer tok-b"}

    firebase_client.post(
        "/api/me/views", json={"name": "Seoul view", "lat": 37.5, "lon": 127.0}, headers=a
    )
    assert len(firebase_client.get("/api/me/views", headers=a).json()["views"]) == 1
    assert firebase_client.get("/api/me/views", headers=b).json()["views"] == []

    firebase_client.put("/api/me/prefs", json={"opacity": 0.4, "voice_muted": True}, headers=a)
    a_prefs = firebase_client.get("/api/me/prefs", headers=a).json()["prefs"]
    b_prefs = firebase_client.get("/api/me/prefs", headers=b).json()["prefs"]
    assert a_prefs["opacity"] == 0.4
    assert b_prefs["opacity"] == 0.92  # untouched default


def test_right_to_erasure_only_touches_caller(firebase_client, monkeypatch):
    _patch_verifier(monkeypatch, {"tok-a": "a", "tok-b": "b"})
    a = {"Authorization": "Bearer tok-a"}
    b = {"Authorization": "Bearer tok-b"}
    firebase_client.post("/api/me/regions", json={"name": "A", "lat": 1, "lon": 1}, headers=a)
    firebase_client.post("/api/me/regions", json={"name": "B", "lat": 2, "lon": 2}, headers=b)

    removed = firebase_client.delete("/api/me/data", headers=a).json()["deleted_documents"]
    assert removed >= 1
    assert firebase_client.get("/api/me/regions", headers=a).json()["regions"] == []
    assert len(firebase_client.get("/api/me/regions", headers=b).json()["regions"]) == 1


def test_invalid_token_is_rejected(firebase_client, monkeypatch):
    _patch_verifier(monkeypatch, {"tok-a": "a"})
    r = firebase_client.get("/api/me", headers={"Authorization": "Bearer forged"})
    assert r.status_code == 401


def test_coordinate_validation_on_save(client):
    r = client.post("/api/me/regions", json={"name": "Nowhere", "lat": 999, "lon": 0})
    assert r.status_code == 422


# ── rate limiting ──────────────────────────────────────────────────────────
def test_rate_limit_returns_429_with_retry_after(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "6")
    monkeypatch.setenv("RATE_LIMIT_BURST", "3")
    get_settings.cache_clear()
    ratelimit.reset()

    codes = [client.get("/api/me/regions").status_code for _ in range(6)]
    assert 200 in codes
    limited = [c for c in codes if c == 429]
    assert limited, f"expected a 429 in {codes}"
    r = client.get("/api/me/regions")
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    get_settings.cache_clear()

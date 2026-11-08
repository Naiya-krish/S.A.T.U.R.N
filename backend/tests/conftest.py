"""Pytest fixtures. All tests here run offline (no network)."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest_asyncio  # noqa: F401  (registers the asyncio plugin used by async tests)

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Tests must never talk to a live LLM or require credentials, whatever the .env says.
os.environ["SATURN_FORCE_MOCK_LLM"] = "1"
os.environ["GOOGLE_CLOUD_PROJECT"] = ""
os.environ.setdefault("NOMINATIM_MIN_INTERVAL_S", "0")
os.environ.setdefault("FIRMS_MAP_KEY", "")


from app.geo.nominatim import nominatim as _nominatim_client


async def _never_throttle():
    return None


@pytest.fixture(autouse=True)
def _fast_nominatim(monkeypatch):
    """Tests never wait for the 1 req/s provider throttle."""
    monkeypatch.setattr(_nominatim_client, "_throttle", _never_throttle, raising=False)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def anyio_backend():
    return "asyncio"


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)

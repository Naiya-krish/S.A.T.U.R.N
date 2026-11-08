"""Time a real Vertex AI turn with the agent's own tool declarations.

Used to decide whether the 45 s model timeout in the orchestrator is too tight.

usage: python scripts/time_vertex.py
"""
import asyncio
import sys
import time

sys.path.insert(0, "backend")

from app.agent.model_client import get_model_client  # noqa: E402
from app.config import get_settings  # noqa: E402


async def main() -> None:
    s = get_settings()
    print(f"project={s.google_cloud_project} model={s.vertex_model} mode={s.agent_mode}")
    client = get_model_client()
    print(f"client={type(client).__name__} name={getattr(client, 'name', '?')}")

    history = [{"role": "user", "text": "Show South Korea and display the latest satellite imagery"}]
    snapshot = '{"camera":{"lat":22.9,"lon":-65.5,"altitude_km":16200},"active_layer":null}'

    for attempt in (1, 2):
        t0 = time.monotonic()
        try:
            turn = await client.turn(history, snapshot=snapshot)
            dt = time.monotonic() - t0
            text = (getattr(turn, "text", "") or "")[:100]
            calls = getattr(turn, "tool_calls", []) or []
            print(f"attempt {attempt}: {dt:.2f}s  tool_calls={len(calls)}  text={text!r}")
        except Exception as exc:  # noqa: BLE001
            dt = time.monotonic() - t0
            print(f"attempt {attempt}: FAILED in {dt:.2f}s -> {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    asyncio.run(main())

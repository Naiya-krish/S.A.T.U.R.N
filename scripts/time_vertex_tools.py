"""Measure a real Vertex turn using the agent's ACTUAL tool declarations.

The earlier timing test used a bare client with no tools. With the full tool
schema the request is much larger and slower, which is why a 40 s cap timed out.

usage: python scripts/time_vertex_tools.py [n]
"""
import asyncio
import statistics
import sys
import time

sys.path.insert(0, "backend")

from app.agent.model_client import get_model_client  # noqa: E402
from app.config import get_settings  # noqa: E402


async def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    s = get_settings()
    print(f"mode={s.agent_mode} model={s.vertex_model} turns={n}")
    client = get_model_client()
    print(f"client={type(client).__name__}")

    history = [{"role": "user", "text": "Zoom into Seoul"}]
    snapshot = '{"camera":{"lat":22.9,"lon":-65.5,"altitude_km":16200}}'

    times = []
    for i in range(1, n + 1):
        t0 = time.monotonic()
        try:
            turn = await client.turn(history, snapshot=snapshot)
            dt = time.monotonic() - t0
            times.append(dt)
            calls = [c[0] for c in (getattr(turn, "tool_calls", None) or [])]
            print(f"turn {i}: {dt:6.2f}s  tool_calls={calls}  text={(turn.text or '')[:50]!r}")
        except Exception as exc:  # noqa: BLE001
            dt = time.monotonic() - t0
            print(f"turn {i}: {dt:6.2f}s  FAILED {type(exc).__name__}: {exc}")

    if times:
        print(
            f"\nmin={min(times):.2f}s  median={statistics.median(times):.2f}s  "
            f"max={max(times):.2f}s  -> recommend a cap of at least {max(times) * 2:.0f}s"
        )


if __name__ == "__main__":
    asyncio.run(main())

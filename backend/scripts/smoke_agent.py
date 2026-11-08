"""Headless agent smoke run against the live providers (no browser needed).

UI actions are acknowledged immediately (simulated) so the model loop can run
without a browser; the real console ACKs actions itself.

Usage:
    .venv\\Scripts\\python.exe scripts\\smoke_agent.py "Show South Korea and display the latest suitable satellite imagery"
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent.orchestrator import AgentOrchestrator  # noqa: E402
from app.tasks import task_bus  # noqa: E402


async def main(command: str) -> int:
    task_bus.headless = True
    task = task_bus.create(command)
    await AgentOrchestrator(task_bus).start(task)
    assert task.runner is not None
    await task.runner
    for ev in task.events:
        data = ev.data
        if ev.kind == "tool":
            print(f"TOOL  {data.get('phase'):7} {data.get('name')} {data.get('summary', '')}")
        elif ev.kind == "ui_action":
            action = data.get("action") or {}
            args = dict(action.get("args") or {})
            if any(k in args for k in ("geojson", "bbox")):
                args["geometry"] = "<outline omitted>"
                args.pop("geojson", None)
                args.pop("bbox", None)
            print(f"UI    {action.get('type')} {args}")
        elif ev.kind == "message":
            print(f"MSG   {data.get('text')}")
        elif ev.kind == "result":
            print("RESULT", data.get("text"))
        elif ev.kind == "error":
            print("ERROR", data)
        elif ev.kind == "status" and data.get("status") in ("failed", "completed", "cancelled"):
            print("STATUS", data.get("status"))
    return 0 if task.status.value == "completed" else 1


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "Show South Korea and display the latest suitable satellite imagery"
    raise SystemExit(asyncio.run(main(cmd)))

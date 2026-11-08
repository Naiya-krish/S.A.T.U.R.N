"""Run the orchestrator in-process with an auto-acknowledging emitter.

Bypasses the browser ACK requirement so the model/tool loop can be exercised
headlessly, and prints any exception in full. Uses the real Task from TaskBus so
nothing about the pipeline is stubbed except the acknowledgement round-trip.

usage: python scripts/run_agent_direct.py "your command"
"""
import asyncio
import logging
import sys
import traceback

sys.path.insert(0, "backend")

from app.tasks import TaskBus  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s %(message)s")


async def main() -> None:
    from app.agent.orchestrator import AgentOrchestrator
    from app.tasks import task_bus

    command = sys.argv[1] if len(sys.argv) > 1 else "Zoom into Seoul"
    task = TaskBus().create(command)
    print(f"task={task.id} command={command!r}")

    async def auto_ack(t, action, args, origin="agent"):
        print(f"  [ui-action] {action} {str(args)[:120]}")
        from app.models import UIActionAck, UIActionStatus

        return UIActionAck(action_id="auto", status=UIActionStatus.EXECUTED, result={"ok": True})

    original = task_bus.emit_action
    task_bus.emit_action = auto_ack  # type: ignore[assignment]
    try:
        AgentOrchestrator(task_bus).__init__
        await AgentOrchestrator(task_bus)._run(task)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    finally:
        task_bus.emit_action = original  # type: ignore[assignment]

    print("\n=== RESULT ===")
    print("status:", task.status)
    snaps = []
    for ev in task.events:
        if ev.kind == "result":
            snaps.append(ev.data)
    reply = snaps[-1].get("text", "") if snaps else ""
    errs = [ev.data for ev in task.events if ev.kind == "error"]
    print("reply :", reply[:500])
    print("error :", errs[-1] if errs else None)
    tools = [ev.data.get("name") for ev in task.events if ev.kind == "tool" and ev.data.get("phase") == "result"]
    print("tools :", tools)


if __name__ == "__main__":
    asyncio.run(main())

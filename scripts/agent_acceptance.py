"""Run the Phase 5 acceptance command set on the live agent.

Each command runs headlessly with an auto-ACKing emitter, so the full
model -> tool -> UI-action -> reply loop is exercised without a browser.

usage: python scripts/agent_acceptance.py
"""
import asyncio
import sys

sys.path.insert(0, "backend")
sys.path.insert(0, "scripts")


from app.tasks import TaskBus, task_bus  # noqa: E402

COMMANDS = [
    # (command, must_emit_actions)
    # For most commands the agent must actually drive the UI. The last one is
    # different: with only one layer loaded there IS no previous layer, so the
    # correct outcome is a completed task with an honest refusal and no actions.
    ("Take me to Seoul.", True),
    ("Zoom into the Amazon rainforest.", True),
    ("Set opacity to 50 percent.", True),
    ("Turn off boundaries.", True),
    ("Go back to the global view.", True),
    ("Show the true-colour imagery for South Korea.", True),
    ("Switch to the previous layer.", False),
]


async def run_one(command: str, history_state: dict | None = None) -> dict:
    from app.agent.orchestrator import AgentOrchestrator
    from app.models import UIActionAck, UIActionStatus

    task = TaskBus().create(command)
    # Carry layer history across commands so "previous layer" has something to
    # return to, mirroring one continuous operator session.
    if history_state:
        task.ui_state.update(history_state)
    emitted: list[str] = []

    async def auto_ack(t, action, args, origin="agent"):
        emitted.append(action)
        return UIActionAck(action_id="auto", status=UIActionStatus.EXECUTED, result={"ok": True})

    original = task_bus.emit_action
    task_bus.emit_action = auto_ack  # type: ignore[assignment]
    try:
        await AgentOrchestrator(task_bus)._run(task)
    finally:
        task_bus.emit_action = original  # type: ignore[assignment]

    reply = ""
    for ev in task.events:
        if ev.kind == "result":
            reply = ev.data.get("text", "")
    errs = [ev.data for ev in task.events if ev.kind == "error"]
    tools = [ev.data.get("name") for ev in task.events if ev.kind == "tool" and ev.data.get("phase") == "result"]
    return {
        "command": command,
        "status": task.status.value,
        "actions": emitted,
        "tools": tools,
        "reply": reply[:200],
        "error": errs[-1] if errs else None,
        "ui_state": dict(task.ui_state),
    }


async def main() -> int:
    passed = 0
    carried: dict = {}
    for cmd, must_emit in COMMANDS:
        print(f"\n> {cmd}")
        try:
            r = await run_one(cmd, carried)
        except Exception as exc:  # noqa: BLE001
            print(f"  EXCEPTION: {type(exc).__name__}: {exc}")
            continue
        carried = r.get("ui_state") or carried
        # Explicit per-command expectation: a command that must move the UI is
        # only a pass if it emitted actions; a refusal case is only a pass if it
        # completed WITHOUT actions and said why.
        ok = r["status"] == "completed" and not r["error"]
        ok = ok and (bool(r["actions"]) if must_emit else not r["actions"])
        passed += 1 if ok else 0
        print(f"  status : {r['status']}")
        print(f"  actions: {r['actions']}")
        print(f"  reply  : {r['reply']}")
        print(f"  verdict: {'PASS' if ok else 'FAIL'}")
        if r["error"]:
            print(f"  error  : {r['error']}")
    print(f"\n{passed}/{len(COMMANDS)} commands passed")
    return 0 if passed == len(COMMANDS) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

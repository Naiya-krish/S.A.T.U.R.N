"""Task bus: in-process task state + SSE event fan-out + action acknowledgements.

* Every agent command is a task with a monotonically increasing event stream.
* UI actions are emitted as task events and wait for a browser ACK.
* Cancellation flips the task to cancelled, unblocks waiters and notifies
  every SSE subscriber so the UI can stop pending actions.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .models import TaskEvent, TaskStatus, UIAction, UIActionAck, UIActionStatus, utcnow
from .ui_actions.registry import validate_action_args

log = logging.getLogger("saturn.tasks")


class TaskCancelled(Exception):
    pass


class ActionRejected(Exception):
    def __init__(self, action_id: str, errors: List[str]):
        super().__init__("; ".join(errors))
        self.action_id = action_id
        self.errors = errors


@dataclass
class Task:
    id: str
    command: str
    mode: str = "text"
    status: TaskStatus = TaskStatus.QUEUED
    events: List[TaskEvent] = field(default_factory=list)
    seq: int = 0
    acks: Dict[str, UIActionAck] = field(default_factory=dict)
    waiters: Dict[str, asyncio.Future] = field(default_factory=dict)
    subscribers: List[asyncio.Queue] = field(default_factory=list)
    ack_enabled: bool = True
    created: str = field(default_factory=lambda: utcnow().isoformat())
    cancelled: bool = False
    runner: Optional[asyncio.Task] = None
    ui_state: Dict[str, Any] = field(default_factory=dict)

    def snapshot(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "command": self.command,
            "mode": self.mode,
            "status": self.status.value,
            "created": self.created,
            "actions": [{"action_id": a.action_id, "status": a.status.value, "error": a.error} for a in self.acks.values()],
        }


class TaskBus:
    def __init__(self) -> None:
        self.tasks: Dict[str, Task] = {}
        self.max_tasks = 64
        # When True, emit_action returns immediately with a simulated ACK
        # (used by headless smoke runs and tests; never in the real server).
        self.headless = False

    # ──────────────────────── lifecycle ────────────────────────
    def create(self, command: str, mode: str = "text", ui_state: Optional[Dict[str, Any]] = None) -> Task:
        if len(self.tasks) >= self.max_tasks:
            for tid in list(self.tasks)[: len(self.tasks) - self.max_tasks + 1]:
                self.tasks.pop(tid, None)
        task = Task(
            id=uuid.uuid4().hex[:12],
            command=command,
            mode=mode,
            ack_enabled=not self.headless,
            ui_state=ui_state or {},
        )
        self.tasks[task.id] = task
        return task

    def get(self, task_id: str) -> Optional[Task]:
        return self.tasks.get(task_id)

    def cancel(self, task_id: str) -> bool:
        task = self.tasks.get(task_id)
        if not task or task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            return False
        task.cancelled = True
        task.status = TaskStatus.CANCELLED
        for fut in task.waiters.values():
            if not fut.done():
                fut.set_exception(TaskCancelled("Task cancelled by user."))
        self.publish(task, "status", {"status": "cancelled"})
        if task.runner and not task.runner.done():
            task.runner.cancel()
        return True

    # ──────────────────────── events / SSE ─────────────────────
    def publish(self, task: Task, kind: str, data: Dict[str, Any]) -> TaskEvent:
        task.seq += 1
        event = TaskEvent(seq=task.seq, kind=kind, task_id=task.id, data=data)  # type: ignore[arg-type]
        task.events.append(event)
        for q in list(task.subscribers):
            q.put_nowait(event)
        return event

    def subscribe(self, task: Task) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        task.subscribers.append(q)
        return q

    def unsubscribe(self, task: Task, q: asyncio.Queue) -> None:
        if q in task.subscribers:
            task.subscribers.remove(q)

    async def event_generator(self, task_id: str):
        """Async generator of SSE strings; replays history then streams live."""
        task = self.tasks.get(task_id)
        if task is None:
            yield _sse({"kind": "error", "data": {"error": "unknown task"}})
            return
        q = self.subscribe(task)
        try:
            for ev in list(task.events):
                yield _sse(ev.model_dump(mode="json"))
            if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
                yield "event: end\ndata: {}\n\n"
                return
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    if task.cancelled:
                        yield "event: end\ndata: {}\n\n"
                        return
                    continue
                yield _sse(ev.model_dump(mode="json"))
                if ev.kind == "status" and ev.data.get("status") in ("completed", "failed", "cancelled"):
                    yield "event: end\ndata: {}\n\n"
                    return
        finally:
            self.unsubscribe(task, q)

    # ──────────────────── UI action round-trip ─────────────────
    async def emit_action(self, task: Task, action_type: str, args: Dict[str, Any], *, origin: str = "agent") -> UIActionAck:
        if task.cancelled:
            raise TaskCancelled("Task cancelled.")
        action_id = uuid.uuid4().hex[:10]
        validation = validate_action_args(action_type, args)
        if not validation.ok:
            ack = UIActionAck(action_id=action_id, status=UIActionStatus.FAILED, error="; ".join(validation.errors))
            task.acks[action_id] = ack
            self.publish(task, "ui_action", {"action": UIAction(**{"action_id": action_id, "type": action_type, "args": args, "origin": origin}).model_dump(mode="json"), "ack": ack.model_dump(mode="json")})
            raise ActionRejected(action_id, validation.errors)

        action = UIAction(**{"action_id": action_id, "type": action_type, "args": args, "origin": origin})  # type: ignore[arg-type]
        task.acks[action_id] = UIActionAck(action_id=action_id, status=UIActionStatus.ACCEPTED)
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        task.waiters[action_id] = fut
        self.publish(task, "ui_action", {"action": action.model_dump(mode="json")})
        if not task.ack_enabled:
            # Headless runs (tests, smoke scripts) simulate an immediate ACK.
            return UIActionAck(action_id=action_id, status=UIActionStatus.EXECUTED, result={"simulated": True})
        try:
            return await asyncio.wait_for(fut, timeout=20.0)
        except asyncio.TimeoutError:
            ack = UIActionAck(action_id=action_id, status=UIActionStatus.FAILED, error="UI did not acknowledge the action within 20s.")
            task.acks[action_id] = ack
            self.publish(task, "ui_action", {"action": action.model_dump(mode="json"), "ack": ack.model_dump(mode="json")})
            return ack
        finally:
            task.waiters.pop(action_id, None)

    def acknowledge(self, task_id: str, ack: UIActionAck) -> bool:
        task = self.tasks.get(task_id)
        if not task:
            return False
        task.acks[ack.action_id] = ack
        self.publish(
            task,
            "ui_action",
            {"action_id": ack.action_id, "ack": ack.model_dump(mode="json"), "kind": "ack"},
        )
        fut = task.waiters.get(ack.action_id)
        if fut and not fut.done():
            fut.set_result(ack)
        return True

    def list_tasks(self) -> List[Dict[str, Any]]:
        return [t.snapshot() for t in self.tasks.values()]


def _sse(payload: Dict[str, Any]) -> str:
    import json

    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


task_bus = TaskBus()

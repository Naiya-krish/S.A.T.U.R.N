"""Orchestrator loop: interpret -> resolve -> plan -> tools -> UI actions -> reply.

Bounded by max tool calls, per-tool timeout, overall timeout and bounded
retries with exponential backoff. Every UI action waits for the browser's
acknowledgement before the agent claims it happened.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List

from ..config import get_settings
from ..models import Freshness, Provenance, TaskStatus, utcnow
from ..tasks import ActionRejected, Task, TaskBus, TaskCancelled
from ..tools.registry import TaskContext, ToolError, tool_registry
from .model_client import ModelUnavailable, get_model_client
from .prompts import state_snapshot_text

log = logging.getLogger("saturn.agent")

_REASONING_KEYS = {"thought", "thoughts", "reasoning", "thinking", "chain_of_thought", "scratchpad"}


def _sanitise_args(args: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in (args or {}).items() if k.lower() not in _REASONING_KEYS}


def _summarise(result: Any) -> str:
    if not isinstance(result, dict):
        return str(result)[:120]
    if result.get("ok") is False:
        return f"error: {result.get('error') or result.get('warnings')}"
    for key in ("ok", "count", "date", "status", "name"):
        if key in result:
            return f"{key}={result[key]}"
    return "done"


class AgentOrchestrator:
    def __init__(self, bus: TaskBus) -> None:
        self.bus = bus

    async def start(self, task: Task) -> None:
        task.runner = asyncio.create_task(self._run(task))

    async def _run(self, task: Task) -> None:
        settings = get_settings()
        model = get_model_client()
        task.status = TaskStatus.RUNNING
        self.bus.publish(task, "status", {"status": "running", "model": model.name, "mode": settings.agent_mode})

        async def emit(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
            ack = await self.bus.emit_action(task, action, args, origin="agent")
            return ack.model_dump(mode="json")

        ctx = TaskContext(task_id=task.id, emit=emit)
        # Camera/layer state known to the browser (sent by the frontend).
        ctx.state.update(getattr(task, "ui_state", None) or {})
        history: List[Dict[str, Any]] = [{"role": "user", "text": task.command}]
        deadline = time.monotonic() + settings.agent_overall_timeout_s
        tool_calls = 0
        final_text = ""
        results_log: List[Dict[str, Any]] = []

        try:
            # One model turn per step. A realistic request needs a few turns
            # (resolve -> imagery -> date -> reply), and the model may batch or
            # retry, so allow more turns than tool calls. The TOOL budget is
            # still enforced below, which is what actually protects cost.
            max_steps = settings.agent_max_tool_calls * 2 + 2
            for _step in range(max_steps):
                if task.cancelled:
                    raise TaskCancelled()
                if time.monotonic() > deadline:
                    raise ModelUnavailable("The task exceeded its overall time budget.", kind="timeout")
                snapshot = state_snapshot_text(ctx.state)
                log.debug(
                    "agent.turn",
                    extra={"extra_fields": {"step": _step, "results": results_log[-4:]}},
                )
                turn = await model.turn(history, snapshot=snapshot)
                if turn.text:
                    self.bus.publish(task, "message", {"role": "assistant", "text": turn.text, "partial": bool(turn.tool_calls)})
                    final_text = turn.text
                if not turn.tool_calls:
                    break
                if tool_calls >= settings.agent_max_tool_calls:
                    # Report the cap honestly instead of returning an empty reply.
                    final_text = final_text or (
                        f"I reached the tool-call limit ({settings.agent_max_tool_calls}) "
                        "before finishing. Please narrow the request."
                    )
                    self.bus.publish(task, "message", {"role": "assistant", "text": final_text})
                    break
                calls, tool_results = [], []
                for name, raw_args in turn.tool_calls:
                    args = _sanitise_args(raw_args)
                    if tool_calls >= settings.agent_max_tool_calls:
                        self.bus.publish(task, "tool", {"name": name, "phase": "skipped", "summary": "tool-call limit reached"})
                        break
                    tool_calls += 1
                    tool = tool_registry.get(name)
                    timeout = tool.timeout_s if tool else settings.agent_tool_timeout_s
                    self.bus.publish(task, "tool", {"name": name, "args": args, "phase": "call"})
                    result: Dict[str, Any]
                    attempt = 0
                    while True:
                        try:
                            if tool is None:
                                raise ToolError(f"Unknown tool '{name}'.", kind="unknown_tool")
                            result = await asyncio.wait_for(
                                tool_registry.call(ctx, name, args), timeout=timeout + 1.0
                            )
                            break
                        except ToolError as exc:
                            if exc.retryable and attempt < 2 and not task.cancelled:
                                attempt += 1
                                await asyncio.sleep(0.6 * (2 ** (attempt - 1)))
                                continue
                            result = exc.as_dict()
                            break
                        except ActionRejected as exc:
                            result = {"ok": False, "error": {"kind": "ui_rejected", "message": str(exc)}}
                            break
                        except asyncio.TimeoutError:
                            result = {"ok": False, "error": {"kind": "timeout", "message": f"{name} timed out."}}
                            break
                    self.bus.publish(task, "tool", {"name": name, "phase": "result", "summary": _summarise(result)})
                    calls.append({"name": name, "args": args})
                    tool_results.append({"name": name, "result": result})
                    results_log.append({"name": name, "summary": _summarise(result)})
                    if task.cancelled:
                        raise TaskCancelled()
                history.append({"role": "model", "tool_calls": calls, "text": ""})
                # Tool results belong to the NEXT model turn (the mock needs the
                # previous model entry for its own tool calls, plus this one).
                history.append({"role": "model", "tool_calls": [], "tool_results": tool_results, "text": ""})

            if not final_text:
                final_text = "Done."
            provenance = Provenance(
                provider=f"S.A.T.U.R.N. agent ({model.name})",
                product="conversational orchestration",
                retrieval_time=utcnow().isoformat(),
                freshness=Freshness.UNAVAILABLE,
                note="Narrative reply. Data values come from the tools listed in the trace.",
            )
            task.status = TaskStatus.COMPLETED
            # Persist the tool-written session state (active layer, history, ...) so
            # the next command in the same session can build on it. Without this
            # write-back "switch to the previous layer" had no history to use.
            task.ui_state.update(ctx.state)
            self.bus.publish(
                task,
                "result",
                {
                    "text": final_text,
                    "model": model.name,
                    "tool_calls": tool_calls,
                    "trace": results_log,
                    "provenance": provenance.model_dump(mode="json"),
                },
            )
            self.bus.publish(task, "status", {"status": "completed"})
        except TaskCancelled:
            task.status = TaskStatus.CANCELLED
            self.bus.publish(task, "status", {"status": "cancelled", "message": "Task cancelled by user."})
        except (ModelUnavailable, Exception) as exc:  # honest failure
            if task.cancelled:
                task.status = TaskStatus.CANCELLED
                self.bus.publish(task, "status", {"status": "cancelled"})
                return
            kind = getattr(exc, "kind", "internal_error")
            message = (
                getattr(exc, "message", None)
                or str(exc)
                or f"{exc.__class__.__name__} (no message)"
            )[:240]
            task.status = TaskStatus.FAILED
            task.error = message
            log.warning("agent.failed", extra={"extra_fields": {"kind": kind, "message": message}})
            self.bus.publish(task, "error", {"kind": kind, "message": message})
            self.bus.publish(task, "status", {"status": "failed"})

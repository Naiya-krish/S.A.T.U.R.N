"""UI Action registry - invalid actions, failures, cancellation."""

from __future__ import annotations

import asyncio

import pytest

from app.models import UIActionAck, UIActionStatus
from app.tasks import ActionRejected, TaskCancelled, TaskBus
from app.ui_actions.registry import ACTION_TYPES, UIActionValidator, validate_action_args


@pytest.fixture(autouse=True)
def loop():
    l = asyncio.new_event_loop()
    asyncio.set_event_loop(l)
    yield l
    l.close()


def test_every_reference_control_has_an_action():
    required = {
        "navigate_globe",
        "set_camera_view",
        "restore_global_view",
        "highlight_location",
        "set_imagery_layer",
        "set_observation_date",
        "set_layer_opacity",
        "toggle_map_overlay",
        "select_dropdown",
        "set_slider",
        "toggle_checkbox",
        "open_panel",
        "close_panel",
        "select_region_card",
        "save_region",
        "start_timeline_playback",
        "compare_dates",
        "focus_event",
        "clear_all",
        "inspect_globe_state",
    }
    assert required <= set(ACTION_TYPES)


@pytest.mark.parametrize(
    "action_type,args",
    [
        ("navigate_globe", {"lat": 95, "lon": 0}),
        ("navigate_globe", {"lat": 10}),
        ("set_layer_opacity", {"value": 1.5}),
        ("toggle_map_overlay", {"overlay": "dragons"}),
        ("select_region_card", {"index": 7}),
        ("set_observation_date", {"date": "yesterday"}),
        ("navigate_globe", {"lat": 10, "lon": 10, "speed": "warp"}),
        ("not_a_real_action", {}),
    ],
)
def test_invalid_actions_rejected(action_type, args):
    result = validate_action_args(action_type, args)
    assert result.ok is False
    assert result.errors


def test_valid_action_accepted():
    assert validate_action_args("navigate_globe", {"lat": 37.5, "lon": 127.0}).ok
    assert validate_action_args("compare_dates", {"mode": "swipe"}).ok


def test_validator_model_rejects_unknown_type():
    with pytest.raises(Exception):
        UIActionValidator(action_id="a1", type="fly_everywhere", args={})


def test_emit_and_ack_roundtrip():
    bus = TaskBus()
    task = bus.create("test")
    task.status = task.status.RUNNING

    async def scenario():
        pending = asyncio.create_task(bus.emit_action(task, "set_layer_opacity", {"value": 0.5}))
        await asyncio.sleep(0.05)
        action_id = next(iter(task.acks))
        bus.acknowledge(task.id, UIActionAck(action_id=action_id, status=UIActionStatus.EXECUTED, result={"value": 0.5}))
        return await pending

    ack = asyncio.get_event_loop().run_until_complete(scenario())
    assert ack.status == UIActionStatus.EXECUTED


def test_failed_action_is_reported():
    bus = TaskBus()
    task = bus.create("test")

    async def scenario():
        pending = asyncio.create_task(bus.emit_action(task, "set_imagery_layer", {"layer_id": "X"}))
        await asyncio.sleep(0.05)
        action_id = next(iter(task.acks))
        bus.acknowledge(task.id, UIActionAck(action_id=action_id, status=UIActionStatus.FAILED, error="tiles unavailable"))
        return await pending

    ack = asyncio.get_event_loop().run_until_complete(scenario())
    assert ack.status == UIActionStatus.FAILED
    assert "tiles" in (ack.error or "")


def test_invalid_action_raises_rejected():
    bus = TaskBus()
    task = bus.create("test")
    with pytest.raises(ActionRejected):
        asyncio.get_event_loop().run_until_complete(bus.emit_action(task, "navigate_globe", {"lat": 123, "lon": 0}))


def test_cancel_unblocks_pending_actions():
    bus = TaskBus()
    task = bus.create("test")

    async def scenario():
        pending = asyncio.create_task(bus.emit_action(task, "restore_global_view", {}))
        await asyncio.sleep(0.05)
        assert bus.cancel(task.id) is True
        with pytest.raises(TaskCancelled):
            await pending

    asyncio.get_event_loop().run_until_complete(scenario())
    assert task.cancelled


def test_emit_after_cancel_is_refused():
    bus = TaskBus()
    task = bus.create("test")
    bus.cancel(task.id)
    with pytest.raises(TaskCancelled):
        asyncio.get_event_loop().run_until_complete(bus.emit_action(task, "clear_all", {}))


def test_events_are_sequenced():
    bus = TaskBus()
    task = bus.create("test")
    bus.publish(task, "status", {"status": "running"})
    bus.publish(task, "message", {"text": "hi"})
    assert [e.seq for e in task.events] == [1, 2]

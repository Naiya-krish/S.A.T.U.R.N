"""Typed UI Action schema (Pydantic mirror of the frontend Zod schema).

Every visible control in the reference UI maps to exactly one action type here.
The frontend UIActionExecutor is the single writer of UI state; the backend
only validates, emits and records acknowledgements.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, Field, field_validator

ArgType = Literal["number", "integer", "string", "boolean", "enum", "object", "array"]


class ArgSpec(BaseModel):
    name: str
    type: ArgType
    required: bool = False
    description: str = ""
    enum: Optional[List[str]] = None
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    default: Any = None


class ActionSpec(BaseModel):
    type: str
    description: str
    args: List[ArgSpec] = Field(default_factory=list)


def _a(name: str, type_: ArgType, required: bool = False, description: str = "", **kw: Any) -> ArgSpec:
    return ArgSpec(name=name, type=type_, required=required, description=description, **kw)


ACTION_SPECS: List[ActionSpec] = [
    ActionSpec(
        type="navigate_globe",
        description="Fly the globe camera to a latitude/longitude (altitude optional, km).",
        args=[
            _a("lat", "number", True, "Latitude in -90..90", minimum=-90, maximum=90),
            _a("lon", "number", True, "Longitude in -180..180", minimum=-180, maximum=180),
            _a("altitude_km", "number", False, "Camera distance from surface in km", minimum=0.2, maximum=40000),
        ],
    ),
    ActionSpec(
        type="set_camera_view",
        description="Set the camera to an explicit rotation/zoom (advanced).",
        args=[
            _a("phi", "number", False, "Polar angle radians (0..pi)"),
            _a("theta", "number", False, "Azimuth radians"),
            _a("altitude_km", "number", False, "Camera distance", minimum=0.2, maximum=40000),
        ],
    ),
    ActionSpec(type="restore_global_view", description="Return to the default global view.", args=[]),
    ActionSpec(
        type="highlight_location",
        description="Draw a boundary/halo and optional marker for a resolved place.",
        args=[
            _a("name", "string", False, "Label"),
            _a("lat", "number", False, "Center latitude"),
            _a("lon", "number", False, "Center longitude"),
            _a("bbox", "array", False, "south,west,north,east"),
            _a("geojson", "object", False, "GeoJSON Polygon/MultiPolygon"),
        ],
    ),
    ActionSpec(
        type="set_imagery_layer",
        description="Load a NASA GIBS imagery layer on the globe.",
        args=[_a("layer_id", "string", True, "GIBS layer identifier")],
    ),
    ActionSpec(
        type="set_observation_date",
        description="Change the observation date (YYYY-MM-DD).",
        args=[_a("date", "string", True, "ISO date")],
    ),
    ActionSpec(
        type="set_layer_opacity",
        description="Set imagery opacity 0..1.",
        args=[_a("value", "number", True, "0..1", minimum=0, maximum=1)],
    ),
    ActionSpec(
        type="toggle_map_overlay",
        description="Toggle a map overlay.",
        args=[
            _a(
                "overlay",
                "enum",
                True,
                "Overlay name",
                enum=["boundaries", "fires", "events", "labels", "grid", "network", "night_lights"],
            )
        ],
    ),
    ActionSpec(
        type="select_dropdown",
        description="Select an option in one of the UI dropdowns.",
        args=[
            _a("control_id", "string", True, "e.g. layer, product, projection, date, cadence"),
            _a("value", "string", True, "Option value"),
        ],
    ),
    ActionSpec(
        type="set_slider",
        description="Set a slider to a value (0..1 or the slider's own range).",
        args=[
            _a("control_id", "string", True, "e.g. opacity, timeline, exposure, gain"),
            _a("value", "number", True, "Slider value"),
        ],
    ),
    ActionSpec(
        type="toggle_checkbox",
        description="Toggle a checkbox control.",
        args=[
            _a(
                "control_id",
                "enum",
                True,
                "Checkbox id",
                enum=["boundaries", "fires", "events", "labels", "grid", "network", "telemetry", "auto_refresh"],
            )
        ],
    ),
    ActionSpec(
        type="open_panel",
        description="Open a panel or drawer.",
        args=[_a("panel_id", "enum", True, "", enum=["layers", "events", "sources", "history", "settings", "chat"])],
    ),
    ActionSpec(
        type="close_panel",
        description="Close a panel or drawer.",
        args=[_a("panel_id", "enum", True, "", enum=["layers", "events", "sources", "history", "settings", "chat"])],
    ),
    ActionSpec(
        type="select_region_card",
        description="Select one of the region cards.",
        args=[_a("index", "integer", True, "0-based card index", minimum=0, maximum=3), _a("region_id", "string", False)],
    ),
    ActionSpec(
        type="save_region",
        description="Save the current region into a slot of the REGION cards.",
        args=[_a("slot", "integer", False, "0-based slot", minimum=0, maximum=3), _a("name", "string", False)],
    ),
    ActionSpec(
        type="start_timeline_playback",
        description="Start or stop date-sequence playback.",
        args=[_a("playing", "boolean", False, "True to play, false to pause"), _a("step_days", "integer", False, "", minimum=1, maximum=30)],
    ),
    ActionSpec(
        type="compare_dates",
        description="Open a date comparison (split swipe of two real tile dates).",
        args=[
            _a("mode", "enum", True, "", enum=["split", "swipe", "off"]),
            _a("date_a", "string", False),
            _a("date_b", "string", False),
        ],
    ),
    ActionSpec(
        type="focus_event",
        description="Fly to and open an event from EONET / FIRMS.",
        args=[_a("event_id", "string", True), _a("lat", "number", False), _a("lon", "number", False)],
    ),
    ActionSpec(type="clear_all", description="Reset every layer, overlay and selection.", args=[]),
    ActionSpec(
        type="show_fire_observations",
        description="Push real NASA FIRMS thermal-anomaly detections onto the globe.",
        args=[_a("detections", "array", True), _a("region", "string", False)],
    ),
    ActionSpec(
        type="inspect_globe_state",
        description="Return a compact snapshot of the UI/globe state.",
        args=[],
    ),
]

ACTION_TYPES: List[str] = [s.type for s in ACTION_SPECS]
_SPEC_BY_TYPE: Dict[str, ActionSpec] = {s.type: s for s in ACTION_SPECS}


class ValidationResult(BaseModel):
    ok: bool
    errors: List[str] = Field(default_factory=list)


def validate_action_args(action_type: str, args: Dict[str, Any]) -> ValidationResult:
    spec = _SPEC_BY_TYPE.get(action_type)
    if spec is None:
        return ValidationResult(ok=False, errors=[f"Unknown UI action type '{action_type}'. Known: {', '.join(ACTION_TYPES)}."])
    errors: List[str] = []
    known = {a.name for a in spec.args}
    for extra in set(args) - known:
        errors.append(f"Unexpected argument '{extra}' for {action_type}.")
    for arg in spec.args:
        if arg.name not in args:
            if arg.required:
                errors.append(f"Missing required argument '{arg.name}'.")
            continue
        value = args[arg.name]
        if arg.type in ("number", "integer"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                errors.append(f"Argument '{arg.name}' must be a number.")
                continue
            if arg.type == "integer" and float(value) != int(value):
                errors.append(f"Argument '{arg.name}' must be an integer.")
            if arg.minimum is not None and value < arg.minimum:
                errors.append(f"Argument '{arg.name}' must be >= {arg.minimum}.")
            if arg.maximum is not None and value > arg.maximum:
                errors.append(f"Argument '{arg.name}' must be <= {arg.maximum}.")
        elif arg.type == "boolean":
            if not isinstance(value, bool):
                errors.append(f"Argument '{arg.name}' must be a boolean.")
        elif arg.type == "string":
            if not isinstance(value, str) or not value.strip():
                errors.append(f"Argument '{arg.name}' must be a non-empty string.")
            elif arg.name == "date" and not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
                errors.append(f"Argument '{arg.name}' must be an ISO date (YYYY-MM-DD).")
        elif arg.type == "enum":
            if value not in (arg.enum or []):
                errors.append(f"Argument '{arg.name}' must be one of {arg.enum}.")
        elif arg.type == "array":
            if not isinstance(value, list):
                errors.append(f"Argument '{arg.name}' must be an array.")
            elif arg.name == "bbox" and len(value) != 4:
                errors.append("Argument 'bbox' must contain south, west, north, east.")
    return ValidationResult(ok=not errors, errors=errors)


class UIActionValidator(BaseModel):
    action_id: str
    type: str
    args: Dict[str, Any] = Field(default_factory=dict)
    origin: Literal["agent", "human", "debug"] = "agent"

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in _SPEC_BY_TYPE:
            raise ValueError(f"Unknown UI action type '{v}'.")
        return v

    @field_validator("action_id")
    @classmethod
    def _has_id(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("action_id must not be empty.")
        return v


def action_specs_as_tool_entries() -> List[Dict[str, Any]]:
    """Compact descriptions the model sees for UI actions."""
    out: List[Dict[str, Any]] = []
    for spec in ACTION_SPECS:
        if spec.type == "inspect_globe_state":
            continue
        args = ", ".join(
            f"{a.name}:{a.type}{'' if a.required else '?'}" + (f"[{'|'.join(a.enum)}]" if a.enum else "")
            for a in spec.args
        )
        out.append({"type": spec.type, "description": spec.description, "args": args})
    return out


def spec_type(name: str) -> Optional[Type[BaseModel]]:
    return _SPEC_BY_TYPE.get(name)

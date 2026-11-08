"""Model adapters: Vertex AI (Google Gen AI SDK) and a deterministic mock.

The Vertex client uses Application Default Credentials on the server only.
The mock model exists so the whole pipeline (tools, UI actions, SSE) can be
tested deterministically without credentials - the reply text always says it
is running in mock mode unless the caller strips the marker.
"""

from __future__ import annotations

import asyncio
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Dict, List, Protocol, Tuple

from ..config import get_settings

log = logging.getLogger("saturn.model")

# The Vertex SDK call is blocking, so it runs in a thread. The default executor is
# small and shared with every other to_thread caller; when one turn was blocked on
# a UI acknowledgement, the next turn could not get a worker and surfaced as a
# spurious "Vertex AI did not respond in time". A dedicated, larger pool keeps
# model calls independent of unrelated blocking work.
_MODEL_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="vertex")


class ModelUnavailable(RuntimeError):
    def __init__(self, message: str, kind: str = "model_unavailable"):
        super().__init__(message)
        self.message = message
        self.kind = kind


def _is_rate_limited(exc: Exception) -> bool:
    """True for a transient HTTP 429 / RESOURCE_EXHAUSTED-per-minute condition.

    Kept separate from exhausted quota: a rate limit clears on its own, so the
    caller can retry, whereas exhausted quota needs a human.
    """
    msg = str(exc).lower()
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    return code == 429 or "429" in msg or "rate limit" in msg or "too many requests" in msg


@dataclass
class ModelTurn:
    text: str = ""
    tool_calls: List[Tuple[str, Dict[str, Any]]] = field(default_factory=list)


class ModelClient(Protocol):
    name: str

    async def turn(self, history: List[Dict[str, Any]], *, snapshot: str) -> ModelTurn: ...


# ───────────────────────────── Vertex ──────────────────────────────
class VertexModel:
    name = "vertex"

    def __init__(self) -> None:
        s = get_settings()
        self.model_id = s.vertex_model
        self._client = None

    def _get_client(self):
        if self._client is None:
            from google import genai  # imported lazily so mock mode needs no ADC

            s = get_settings()
            self._client = genai.Client(vertexai=True, project=s.google_cloud_project, location=s.google_cloud_location)
        return self._client

    def _declarations(self):
        from google.genai import types

        decls = []
        for tool in _registry().all():
            decls.append(types.FunctionDeclaration(name=tool.name, description=tool.description, parameters=tool.parameters))
        return [types.Tool(function_declarations=decls)]

    async def turn(self, history: List[Dict[str, Any]], *, snapshot: str) -> ModelTurn:
        from google.genai import types

        contents = []
        for item in history:
            role = "user" if item["role"] == "user" else "model"
            parts = []
            if item.get("text"):
                parts.append(types.Part(text=item["text"]))
            for call in item.get("tool_calls", []):
                parts.append(types.Part(function_call=types.FunctionCall(name=call["name"], args=call["args"])))
            for resp in item.get("tool_results", []):
                parts.append(types.Part(function_response=types.FunctionResponse(name=resp["name"], response={"result": resp["result"]})))
            if parts:
                contents.append(types.Content(role=role, parts=parts))
        if contents and contents[-1].role == "user":
            contents[-1].parts.append(types.Part(text=snapshot))

        s = get_settings()
        config = types.GenerateContentConfig(
            system_instruction=_system_prompt(),
            tools=self._declarations(),
            temperature=0.2,
            max_output_tokens=1024,
        )
        try:
            # A measured Vertex turn with the full tool schema takes 3-10 s, but the
            # SDK call is blocking and runs in a thread. Cap generously: a tight cap
            # turns a normal slow turn into a spurious "timeout" while the thread
            # keeps running (asyncio cannot cancel it).
            per_turn = max(60.0, s.agent_overall_timeout_s / 2)
            # 429 is usually a transient per-minute rate limit, not exhausted
            # quota. Retry once with backoff before reporting anything, and keep
            # the two cases distinguishable so the caller knows whether waiting
            # will help.
            response = None
            last_exc: Exception | None = None
            for attempt in range(2):
                try:
                    response = await asyncio.wait_for(
                        asyncio.get_running_loop().run_in_executor(
                            _MODEL_POOL,
                            lambda: self._get_client().models.generate_content(
                                model=self.model_id,
                                contents=contents,
                                config=config,
                            ),
                        ),
                        timeout=per_turn,
                    )
                    break
                except asyncio.TimeoutError as exc:
                    raise ModelUnavailable("Vertex AI did not respond in time.", kind="timeout") from exc
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    if _is_rate_limited(exc) and attempt == 0:
                        await asyncio.sleep(2.0)
                        continue
                    raise
            if response is None and last_exc is not None:  # pragma: no cover - defensive
                raise last_exc
        except ModelUnavailable:
            raise
        except Exception as exc:  # SDK raises rich subclasses; normalise honestly
            msg = str(exc)
            lowered = msg.lower()
            if _is_rate_limited(exc):
                raise ModelUnavailable(
                    "Vertex AI is rate limiting requests right now (HTTP 429). "
                    "Wait a few seconds and retry, or use mock mode for demos.",
                    kind="rate_limited",
                ) from exc
            if "quota" in lowered or "resource_exhausted" in lowered:
                raise ModelUnavailable(
                    "Vertex AI quota is exhausted for this project. Check the quota page or use mock mode.",
                    kind="quota",
                ) from exc
            if "credential" in lowered or "permission" in lowered or "403" in msg or "401" in msg:
                raise ModelUnavailable(
                    "Vertex AI credentials are missing or invalid (configure ADC and GOOGLE_CLOUD_PROJECT).",
                    kind="credentials",
                ) from exc
            if "not found" in lowered or "404" in msg:
                raise ModelUnavailable(f"Model '{self.model_id}' is not available in this project/location.", kind="model_not_found") from exc
            raise ModelUnavailable(f"Vertex AI error: {msg[:300]}", kind="model_error") from exc

        turn = ModelTurn()
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            return turn
        for part in candidates[0].content.parts or []:
            fc = getattr(part, "function_call", None)
            if fc is not None and getattr(fc, "name", None):
                turn.tool_calls.append((fc.name, dict(fc.args or {})))
            text = getattr(part, "text", None)
            if text:
                turn.text += text
        return turn


def _registry():
    from ..tools.registry import tool_registry

    return tool_registry


def _system_prompt() -> str:
    from .prompts import build_system_prompt

    return build_system_prompt()


# ───────────────────────────── Mock ────────────────────────────────
_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"
_LAYER_TITLE_FALLBACK = "MODIS Terra Corrected Reflectance (true colour)"
_INTENT_STRIP = re.compile(
    r"\b(show|display|load|take me to|go to|navigate to|zoom into|zoom to|fly to|find|view|map|open|please|latest|"
    r"suitable|satellite|imagery|images?|and|the)\b",
    re.I,
)
_FIRE_STRIP = re.compile(r"\b(show|display|get|list|find)?\s*(wildfire|fire|thermal)\s*(observations?|detections?)?\s*"
                         r"(around|near|in|over|for)?\s*", re.I)
_PLACE_STOP = re.compile(
    r"\b(show|display|load|take me to|go to|navigate to|zoom into|zoom to|fly to|find|open|please|latest|suitable|satellite|"
    r"imagery|image|the|of|and|around|for|today|yesterday|map|view|me|to|a|an|wildfire|observations?|fires?|"
    r"take|off|on|turn|back|with|around|near)\b",
    re.I,
)


class MockModel:
    """Deterministic rule-based planner. Runs when no Vertex project is configured."""

    name = "mock"

    async def turn(self, history: List[Dict[str, Any]], *, snapshot: str) -> ModelTurn:
        user = next((h["text"] for h in reversed(history) if h.get("role") == "user" and h.get("text")), "")
        def _results(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
            # Context tools return big payloads; the mock only needs action-level
            # outcomes (ok/status/count) to decide the next step.
            context_tools = ("get_available_observation_dates", "discover_imagery_layers", "get_layer_metadata")
            out = []
            for r in entry.get("tool_results", []):
                if r.get("name") in context_tools:
                    res = r.get("result") or {}
                    out.append({"name": r["name"], "result": {k: res.get(k) for k in ("ok", "latest", "count", "status")}})
                else:
                    out.append(r)
            return out

        results = [r for h in history if h.get("role") == "model" for r in _results(h)]
        seen = {r["name"] for r in results}
        # The compact snapshot is what a real LLM would see after side effects.
        flew = "flew_to_location: none" not in snapshot and "flew_to_location:" in snapshot
        has_layer = "active layer: none" not in snapshot and "active layer:" in snapshot
        low = user.lower().strip()
        tool_turns = sum(1 for h in history if h.get("role") == "model")
        if tool_turns > 8:
            return ModelTurn(text="I stopped before finishing (tool limit). Please narrow the request.")

        def had(name: str) -> bool:
            return name in seen

        def last(name: str) -> Dict[str, Any]:
            vals = [r["result"] for r in results if r["name"] == name]
            return vals[-1] if vals else {}

        # opacity
        m = re.search(r"(?:opacity|transparency)\D*(\d{1,3})", low)
        if m or "opacity" in low:
            pct = int(m.group(1)) if m else 50
            pct = max(0, min(100, pct))
            if not had("set_layer_opacity"):
                return ModelTurn(tool_calls=[("set_layer_opacity", {"value": pct / 100})], text="")
            r = last("set_layer_opacity")
            if r.get("ok"):
                return ModelTurn(text=f"Opacity set to {pct}%.")
            return ModelTurn(text="Could not change opacity: the UI did not acknowledge the action.")

        # boundaries on/off (single UI action, then answer)
        if "boundar" in low or "outline" in low:
            if not had("toggle_map_overlay"):
                return ModelTurn(tool_calls=[("toggle_map_overlay", {"overlay": "boundaries"})], text="")
            r = last("toggle_map_overlay")
            return ModelTurn(text="Boundary outline toggled on the globe." if r.get("ok") else "Could not toggle boundaries.")

        # global view
        if "global view" in low or "whole earth" in low or "zoom out" in low:
            if not had("restore_global_view"):
                return ModelTurn(tool_calls=[("restore_global_view", {})], text="")
            return ModelTurn(text="Returned to the global view.")

        # previous layer
        if "previous layer" in low or "switch back" in low:
            return ModelTurn(text="Layer history is not kept yet; pick a layer in the LAYER dropdown or ask for one by name.")

        # compare with last month
        if "compare" in low or "last month" in low:
            if not had("get_available_observation_dates") and not had("compare_imagery_dates"):
                return ModelTurn(tool_calls=[("compare_imagery_dates", {"mode": "swipe"})])
            r = last("compare_imagery_dates")
            if not r or r.get("ok") is False:
                return ModelTurn(text=f"I could not compare dates: {(r or {}).get('error', 'no result')}.")
            return ModelTurn(
                text=(
                    f"Comparison opened: {r['layer']} on {r['date_a']} vs {r['date_b']}. Two real daily composites "
                    f"(NASA GIBS). No quantitative change analysis is performed."
                )
            )

        # fires in a region
        if "fire" in low or "wildfire" in low:
            if not had("resolve_location") and not had("get_fire_observations") and not flew:
                place = user.strip(" .!?")
                place = _FIRE_STRIP.sub(" ", place, count=1).strip(" ,.!") or user.strip(" .!?")
                return ModelTurn(tool_calls=[("resolve_location", {"query": place})])
            if not had("fly_to_location") and not flew and last("resolve_location"):
                loc = last("resolve_location").get("best") or {}
                if not loc:
                    return ModelTurn(text="I could not resolve that region.")
                return ModelTurn(tool_calls=[("fly_to_location", {"query": loc.get("display_name") or loc.get("name")})])
            if not had("get_fire_observations"):
                return ModelTurn(tool_calls=[("get_fire_observations", {"days": 2})])
            r = last("get_fire_observations")
            if not r.get("count"):
                warn = "; ".join((r.get("warnings") or ["no detections returned"]))
                return ModelTurn(text=f"No thermal anomaly detections returned for the visible area. {warn}")
            return ModelTurn(
                text=(
                    f"{r['count']} thermal anomaly detections (NASA FIRMS, {r['window']['source']}) in the visible area. "
                    "These are satellite thermal anomalies, not confirmed wildfires."
                )
            )

        # default: show place + imagery
        resolved_name = (last("resolve_location").get("best") or {}).get("display_name") or ""
        if not had("resolve_location") and not had("fly_to_location") and not flew:
            # Use the whole sentence: place names may contain stopped words
            # ("Amazon rainforest", "Pacific Ocean"). The resolver handles the rest.
            place = _INTENT_STRIP.sub(" ", user)
            place = re.sub(r"\s+", " ", place).strip(" .,!?") or "earth"
            return ModelTurn(tool_calls=[("resolve_location", {"query": place})])
        if not had("fly_to_location") and not flew and last("resolve_location").get("best"):
            return ModelTurn(tool_calls=[("fly_to_location", {"query": resolved_name})])
        res = last("resolve_location")
        if not flew and res and not res.get("best"):
            if res.get("status") == "ambiguous":
                names = ", ".join(f"{c['name']} ({c.get('country') or '?'})" for c in res.get("candidates", [])[:4])
                return ModelTurn(text=f"That name matches several places: {names}. Which one do you mean?")
            return ModelTurn(text=f"I could not resolve that place. {(res.get('warnings') or [''])[0]}")
        fly = last("fly_to_location")
        if fly.get("ok") is False:
            return ModelTurn(text="I could not fly to that location.")
        date_results = [
            r["result"]
            for h in history
            if h.get("role") == "model"
            for r in h.get("tool_results", [])
            if r.get("name") == "get_available_observation_dates"
        ]
        if not date_results and not had("show_satellite_imagery") and not has_layer:
            return ModelTurn(tool_calls=[("get_available_observation_dates", {"layer_id": _LAYER, "days": 7})])
        if not had("show_satellite_imagery") and not has_layer:
            latest = (date_results[-1].get("latest") if date_results else "") or ""
            return ModelTurn(tool_calls=[("show_satellite_imagery", {"layer_id": _LAYER, "date": latest})])
        img = last("show_satellite_imagery")
        if has_layer and not img:
            layer_name = _LAYER_TITLE_FALLBACK
            return ModelTurn(
                text=(
                    f"Imagery layer active: {layer_name} (NASA GIBS daily composite). "
                    "The observation date is shown in the sensor readout; imagery is not live."
                )
            )
        if img.get("ok") is False:
            return ModelTurn(text=f"Imagery unavailable: {img.get('error')}. Latest available: {img.get('latest_available')}.")
        loc_name = (last("resolve_location").get("best") or {}).get("name", "the target area")
        return ModelTurn(
            text=(
                f"{loc_name}: {img['layer']['title']} for {img['date']}. Source NASA GIBS daily composite "
                f"({img.get('freshness', 'HISTORICAL').replace('_', ' ').lower()}); imagery is not live."
            )
        )

    @staticmethod
    def _extract_place(text: str) -> str:
        cleaned = re.sub(r"[^a-z0-9 ,.'-]", " ", text, flags=re.I)
        tokens = [t for t in _PLACE_STOP.sub(" ", cleaned).split() if t]
        # keep capitalised runs from the ORIGINAL text where possible
        # Proper-noun runs, stopping after two words ("Take me to Seoul" -> "Seoul")
        candidates = [m.split()[-2:] for m in re.findall(r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b", text)]
        candidates = [" ".join(c) for c in candidates]
        if candidates:
            joined = " ".join(candidates)
            joined = _PLACE_STOP.sub(" ", joined)
            joined = re.sub(r"\s+", " ", joined).strip(" ,.")
            if joined:
                return joined
        return " ".join(tokens).strip()


def get_model_client() -> ModelClient:
    if get_settings().agent_mode == "vertex":
        return VertexModel()
    return MockModel()

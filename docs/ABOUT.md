# About S.A.T.U.R.N.

**S.A.T.U.R.N.** — *Sentient Agentic Terrain & Universe Reconnaissance Network* — is an
Earth-intelligence command console. It is not a chat window bolted onto a 3D globe: the language
model operates the interface itself. Every dial, dropdown, checkbox, card and camera move in the
HUD is a typed **UI action** that both a human and the agent drive through the same executor.

## What a session looks like

1. Boot sequence (orbital rings, S.A.T.U.R.N. wordmark).
2. The console: clock, system status, time log, sensor readout on the left; title and the live
   globe in the centre; target parameters, region cards and the task queue on the right; data
   source configuration, sliders and overlay toggles on the far right; the LAT/LON/VEL/TEMP/ALT
   strip and the command bar at the bottom.
3. You say: *“Show South Korea and display the latest suitable satellite imagery.”*
4. The agent resolves the place with OpenStreetMap, draws the boundary, flies the globe, asks NASA
   GIBS for valid dates, loads the newest daily composite, and answers with the layer, the date
   and the source.

## What it will not do

* invent a temperature, a velocity or a satellite pass,
* call a daily composite “live”,
* call a thermal anomaly a wildfire,
* claim a policy applied before the interface acknowledged it.

## Controls with real state

| HUD element | Bound to |
|---|---|
| Clock | device clock + selectable IANA timezone |
| SYSTEM STATUS | `/api/health`, `/api/agent/config`, browser connectivity, freshness |
| TIME LOG | agent commands, tool calls, UI actions, camera moves |
| SENSOR READOUT | active GIBS layer, observation date, tile coverage, event counts |
| Floating control panel | imagery opacity, available dates, playback, HUD gain |
| Center readout | camera lat/lon/altitude, camera ground-track velocity, TEMP = N/A |
| TARGET PARAMS | highlighted region spans and boundaries |
| REGION cards | resolved regions (name, bbox, status) |
| Task queue | tile loading, UI actions executed, timeline, agent stage |
| Far-right column | layer/product/projection/date dropdowns, overlay checkboxes, sliders |

## Credit

Imagery: NASA GIBS / EOSDIS. Places: © OpenStreetMap contributors (ODbL). Events: NASA EONET.
Fires: NASA FIRMS. Reasoning: Google Vertex AI (when configured).

# API reference

Base URL (dev): `http://127.0.0.1:8787/api` — the Vite dev server proxies `/api` from
`http://localhost:5173`.

All errors are JSON: `{ "error": "message", "provider": "..." }` or FastAPI's `{ "detail": ... }`.
Every response carries `X-Request-ID`; logs are JSON lines keyed by that id.

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | liveness, version, uptime, agent mode (`vertex`/`mock`), server time |
| GET | `/ready` | readiness of GIBS / Nominatim / EONET / FIRMS / model |

```json
{ "status": "ok", "service": "saturn-backend", "agent_mode": "mock", "now": "2026-10-30T...Z" }
```

## Geo (OpenStreetMap Nominatim)

| Method | Path | Query |
|---|---|---|
| GET | `/geo/resolve` | `q` (name or `lat, lon`), `limit`, `lat`+`lon` (bias) |
| GET | `/geo/context` | `q` |

`/geo/resolve` returns `200` for `resolved`/`ambiguous`, `404` for `not_found`, `422` for
`invalid`.

```json
{
  "query": "South Korea",
  "status": "resolved",
  "needs_clarification": false,
  "best": { "id": "relation-307756", "name": "South Korea", "lat": 36.5, "lon": 127.75,
            "bbox": [33.0, 124.5, 37.0, 130.0], "type": "administrative", "country": "South Korea" },
  "candidates": [ ... ],
  "boundary": { "type": "Polygon", "coordinates": [[[124.5,33.0], "..."]], "is_exact": true,
                "note": "Administrative/feature outline returned by OpenStreetMap (ODbL)." },
  "warnings": [],
  "provenance": { "provider": "OpenStreetMap Nominatim", "freshness": "RECENT_OBSERVATION", "...": "..." }
}
```

`bbox` order is **south, west, north, east**. Antimeridian-crossing outlines are unwrapped
(longitudes > 180) so clients can split them safely.

## Imagery (NASA GIBS)

| Method | Path | Description |
|---|---|---|
| GET | `/imagery/layers` | curated verified layers |
| GET | `/imagery/layer/{layer_id}` | single layer metadata |
| GET | `/imagery/dates?layer_id=&days=14` | available dates, newest first |
| POST | `/imagery/plan` | `{ layer_id, date }` → WMTS tile plan; `400` on unavailable dates |

```json
{
  "layer_id": "MODIS_Terra_CorrectedReflectance_TrueColor",
  "date": "2026-11-01",
  "tile_matrix_set": "GoogleMapsCompatible_Level9",
  "tile_template": "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-01/GoogleMapsCompatible_Level9/{z}/{y}/{x}.{ext}",
  "format": "image/jpeg",
  "max_zoom": 9,
  "provenance": { "provider": "NASA GIBS", "freshness": "RECENT_OBSERVATION",
                  "observation_time": "2026-11-01 (daily composite)", "note": "Daily composite imagery — not a live sensor feed." }
}
```

Clients must substitute **both** `{ext}` and use the returned `tile_matrix_set` verbatim:

* `{ext}` is `jpeg` for JPEG layers and `png` for PNG layers. GIBS serves `.jpeg`, not `.jpg`;
  using `.jpg` returns 404 on most layers.
* The matrix set is the layer's own value. Substituting a generic `GoogleMapsCompatible` makes
  GIBS reject every tile with *"TILEMATRIXSET is invalid for LAYER"*.

Tile URLs follow WMTS order `{TileMatrix}/{TileRow}/{TileCol}`, i.e. `{z}/{y}/{x}`.

## Events

| Method | Path | Body / query |
|---|---|---|
| GET | `/events` | `days`, `status=open`, `bbox=south,west,north,east`, `category` |
| POST | `/fires` | `{ "bbox": [s,w,n,e], "days": 2, "source": "VIIRS_SNPP_NRT" }` |

`/fires` without `FIRMS_MAP_KEY` returns `200` with `count: 0`, `freshness: UNAVAILABLE` and a
warning — it never fabricates detections.

## Agent

| Method | Path | Description |
|---|---|---|
| POST | `/agent/command` | `{ "text": "...", "mode": "text"\|"voice" }` → `{ task_id }` |
| GET | `/agent/config` | mode, model, limits, FIRMS configured |
| GET | `/tasks/{id}/events` | **SSE** stream (see below) |
| GET | `/tasks/{id}` | task snapshot with actions and their status |
| POST | `/tasks/{id}/cancel` | cancel the task and all pending actions |
| GET | `/tasks` | recent tasks |

### SSE event shape

```
data: {"seq":1,"kind":"status","task_id":"…","data":{"status":"running","model":"mock"}}
data: {"seq":2,"kind":"tool","data":{"name":"resolve_location","phase":"call","args":{...}}}
data: {"seq":3,"kind":"ui_action","data":{"action":{"action_id":"ab12","type":"navigate_globe","args":{...}}}}
data: {"seq":4,"kind":"message","data":{"role":"assistant","text":"…","partial":true}}
data: {"seq":5,"kind":"result","data":{"text":"…","tool_calls":4,"trace":[...],"provenance":{...}}}
event: end
data: {}
```

Kinds: `status`, `tool`, `ui_action`, `message`, `error`, `result`.

### UI actions

| Method | Path | Description |
|---|---|---|
| GET | `/ui-actions/spec` | typed action specifications |
| POST | `/ui-actions/validate` | `{ "type": "...", "args": {...} }` → `{ ok, errors }` |
| POST | `/ui-actions/{action_id}/ack` | browser acknowledgement |

Action types: `navigate_globe`, `set_camera_view`, `restore_global_view`, `highlight_location`,
`set_imagery_layer`, `set_observation_date`, `set_layer_opacity`, `toggle_map_overlay`,
`select_dropdown`, `set_slider`, `toggle_checkbox`, `open_panel`, `close_panel`,
`select_region_card`, `save_region`, `start_timeline_playback`, `compare_dates`, `focus_event`,
`clear_all`, `inspect_globe_state`.

ACK body:

```json
{ "action_id": "ab12", "status": "executed", "result": { "date": "2026-10-29" }, "error": null }
```

`status` ∈ `accepted | executed | failed | cancelled`. The agent is blocked until the ACK arrives
(20 s timeout → honest failure).

---

## Authentication & saved data (Phase 8)

Auth is **tri-state** and always reported, never assumed. `GET /api/auth/config` is public and
tells the browser which mode is live:

| Mode | Condition | Protected routes |
|---|---|---|
| `firebase` | `GOOGLE_CLOUD_PROJECT` set + Firebase enabled | require a verified ID token |
| `demo` | no Firebase project | accept no token; one shared sandbox identity |
| `disabled` | `SATURN_AUTH=disabled` | return `503` |

```json
{
  "mode": "firebase",
  "accounts_enabled": true,
  "storage": "local",
  "persistent": false,
  "firebase_project": "your-project",
  "notice": "Accounts are available, but Firestore is not configured on the server, so saved regions are kept in process memory and are lost on restart."
}
```

`persistent` is `false` whenever storage is in-memory. The notice changes to match reality — the
API never promises durability it does not have.

### Routes

All of these require `Authorization: Bearer <Firebase ID token>` in `firebase` mode.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/auth/config` | — | public; mode + notice |
| GET | `/me` | — | caller identity `{uid, email, mode}` |
| GET | `/me/regions` | — | saved regions |
| POST | `/me/regions` | `{name, lat, lon, bounds?, layer_id?, observation_date?, note?}` | `422` if lat/lon out of range |
| DELETE | `/me/regions/{id}` | — | `404` if not yours |
| GET | `/me/views` | — | saved camera views |
| POST | `/me/views` | `{name, lat, lon, altitude_km?, overlays?}` | |
| DELETE | `/me/views/{id}` | — | `404` if not yours |
| GET | `/me/prefs` | — | overlays, opacity, voice settings |
| PUT | `/me/prefs` | `{overlays?, opacity?, voice_muted?, voice_volume?}` | |
| DELETE | `/me/data` | — | right to erasure; deletes every document for the caller |

Documents are stored under `saturn/users/{uid}/{regions|views|prefs}`. The `uid` always comes from
the verified token, never from the request body, so there is no path to another user's data.

### Rate limiting

Protected routes are limited per user (or per client IP when anonymous). Defaults: **30
requests/minute, burst 10**, configurable with `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_BURST`.

A rejected request returns `429` with `Retry-After` and `X-RateLimit-Limit`. The limiter runs
*after* authentication, so a `401` never consumes quota. Buckets are process-local; running more
than one instance requires a shared store.

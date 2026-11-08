# Development roadmap

Status legend: ✅ done & verified · 🟡 partial · ⬜ not started

## Phase 0 — Reference-image UI
- ✅ 1456×720 design canvas, three HUD columns, title frame, readout strip, command bar, loader
- ✅ Palette, panel chrome (1 px border, corner brackets, glow), typography
- ✅ Globe matched numerically against `docs/reference/globe-reference.png` and
  `The main reference.png` (disc size, interior brightness, limb, background field)
- ✅ Readout strip re-centred to clear both side columns

## Phase 1 — Foundation & interactive globe ✅
- ✅ Vite/React/TS scaffold, FastAPI `/health` `/ready`, JSON logs with request ids, CORS
- ✅ Custom Three.js globe: rotate/zoom (mouse+touch), flyTo with easing, resetView, reduced motion
- ✅ Coordinate maths + unit tests (backend pytest, frontend vitest)
- ✅ Live clock, connectivity, backend status

## Phase 2 — Global location resolution ✅
- ✅ `resolve_location`, `get_location_coordinates`, `get_location_bounding_box`,
  `get_location_boundaries`, `get_geographic_context`
- ✅ Nominatim cache + 1 req/s throttle + User-Agent; ranked candidates + clarification
- ✅ Coordinate parsing; antimeridian-safe outlines; approximate outlines flagged
- ✅ Search box, globe outline, region cards
- 🟡 Real-network tests are opt-in (`SATURN_REAL_NETWORK=1`)

## Phase 3 — Real satellite imagery (NASA GIBS) ✅
- ✅ WMTS capabilities parsing, curated layer set, date validation, tile plans
- ✅ Progressive tile patches on the sphere with cache and failure handling
- ✅ Layer dropdown, date slider, opacity, toggles, provenance strip + NASA acknowledgement

## Phase 4 — UI Action Registry ✅
- ✅ Zod schema + Pydantic mirror, single executor, inspect_globe_state
- ✅ SSE `/api/tasks/{id}/events`, ACK endpoint, `AGENT CONTROLLING` + `STOP`
- ✅ Invalid action / failure / cancellation tests (backend + frontend)

## Phase 5 — Vertex AI agent ✅ (live)
- ✅ Tool registry (21 tools) with permissions/timeouts, orchestrator loop with limits and retries
- ✅ Compact state snapshot, honest error kinds (quota / credentials / timeout)
- ✅ **Verified against live Vertex AI** (`gemini-2.5-flash`, ADC): core workflow resolves,
  flies, loads real tiles and replies with provider + date; 6/7 acceptance commands pass, the
  seventh correctly reports "no previous layer" when only one has been loaded
- ✅ Layer history persisted across commands (`ui_state` write-back)

## Phase 6 — Voice & text ✅ (browser) / 🟡 (wake word)
- ✅ Push-to-talk Web Speech, TTS with mute/volume, unsupported/permission-denied paths
- ✅ Same `/api/agent/command` pipeline, interruption cancels cleanly
- ⬜ Wake word (needs Porcupine key or equivalent)

## Phase 7 — Events, fires, comparison 🟡
- ✅ EONET adapter + overlay + evidence drawer; FIRMS adapter with honest UNAVAILABLE state
- ✅ `compare_imagery_dates` state + two-date provenance
- ⬜ Split/swipe shader rendering of both dates on the globe
- ⬜ `summarize_regional_changes` (needs a real analysis, not a claim)
- ⬜ FIRMS not exercised live (no `FIRMS_MAP_KEY` on this machine)

## Phase 8 — Firebase, saved investigations, PWA ✅
- ✅ Tri-state auth (`firebase` / `demo` / `disabled`) with server-side ID-token verification that
  fails closed; Admin SDK, verified identities cached briefly by token hash
- ✅ Saved regions / views / prefs under `saturn/users/{uid}/…`; uid always from the token
- ✅ Cross-user isolation proven by tests (read, delete, prefs, erasure scoping)
- ✅ Firestore rules: default deny, owner-only, shape validation; 8 emulator rules tests
- ✅ Token-bucket rate limiting with `Retry-After`, applied after auth
- ✅ PWA: manifest, 3 icons, app-shell-only service worker, offline banner (verified 0 API/0 tile
  responses cached), safe areas, landscape drawer cap
- ✅ `/api/auth/config` never promises persistence it does not have
- ⬜ Monitoring tools deliberately omitted: no scheduled protected job exists to justify them

## Phase 9 — Deployment & docs 🟡
- ✅ README, ARCHITECTURE, API, DATA_SOURCES, SECURITY, MOBILE, DEPLOYMENT, ROADMAP, `.env.example`
- ✅ `Dockerfile` (non-root, healthcheck, honours injected `PORT`), `deploy/cloudrun.yaml`,
  `firebase.json`, `firestore.rules`, `firestore.indexes.json`
- ✅ Final multi-continent verification: 9/9 locations, real tile HTTP 200
- ⬜ **Deployment not performed** — configs are written for the operator to run
  (see `docs/DEPLOYMENT.md`); nothing was deployed from this workspace

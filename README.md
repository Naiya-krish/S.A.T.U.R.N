# S.A.T.U.R.N.

**Sentient Agentic Terrain & Universe Reconnaissance Network** — a voice- and text-controlled
Earth-intelligence command center. You speak or type; the S.A.T.U.R.N. agent resolves the place,
flies the 3D globe, loads **real NASA satellite imagery**, updates every HUD panel, and reports the
source and observation date.

> Imagery is real. The honesty rules are strict: nothing decorative is presented as live data,
> no value is invented, and every layer carries provider / product / observation time /
> retrieval time / freshness.

---

## 1. What is in the box

### Build status (verified by running the test suites)

| Area | State |
|---|---|
| Phase 0 — reference UI | Built. Panels, palette, typography, readouts match `docs/reference/The main reference.png`; globe matched numerically. |
| Phase 1 — interactive globe | Working. Custom Three.js sphere, rotate/zoom, `flyTo`, reduced motion. |
| Phase 2 — location resolution | Working. Nominatim with caching, rate limit, ambiguity handling, GeoJSON outlines. |
| Phase 3 — NASA GIBS imagery | **Working end-to-end.** Real MODIS/VIIRS tiles load (16/16 verified, 0 failed). |
| Phase 4 — UI Action Registry | Working. Every control is agent-drivable; actions ACK from the browser over SSE. |
| Phase 5 — Vertex AI agent | Built and tested in mock mode; live Vertex path needs your credentials (see 4.1). |
| Phase 6 — voice / text | Working. Web Speech API, push-to-talk, mute/volume, graceful fallback. |
| Phase 7 — events / fires | EONET working; FIRMS needs `FIRMS_MAP_KEY`. |
| Phase 8 — Firebase / PWA | **Built.** Optional auth (tri-state), per-user saved data, rules + tests, PWA with shell-only caching, offline banner. |
| Phase 9 — deployment | **Config + docs complete.** Dockerfile, Cloud Run manifest, Hosting config, full runbook. Nothing deployed. |

| Tests | Result |
|---|---|
| Backend `pytest` | **86 passed, 6 skipped** (skips need live network or a FIRMS key) |
| Frontend `vitest` | **20 passed** |
| Type-check `tsc -b` | **clean** |
| Firestore rules tests | 8 tests, run under the emulator (`firebase emulators:exec`) |
| Multi-continent verify | **9/9 locations pass** (`scripts/final_verify.py`) |
| PWA check | manifest valid, SW active, **0 API / 0 tile responses cached** |

Fixes made during verification, all covered by regression tests:

* GIBS tile URLs used a generic `GoogleMapsCompatible` matrix set and a `.jpg` extension. GIBS
  rejected every tile ("TILEMATRIXSET is invalid for LAYER"). Now uses the layer's own matrix set
  and `.jpeg`.
* Imagery was composited as a small patch, which rendered as vertical slivers. Replaced with a
  single whole-world equirectangular overlay, with polar caps filled from the nearest observed row.
* `{ext}` was never substituted in tile templates, so URLs contained a literal `{ext}` and 404'd.
* Tile freshness ignored the injected `today`, making it untestable and time-dependent.
* **"Amazon rainforest" resolved to a garden in Los Angeles.** Regional queries now require a
  region-sized bounding box and fall back to a flagged reference point rather than a confident
  wrong answer. (`tests/test_regional_resolution.py`)
* `run.py` ignored Cloud Run's injected `PORT`, so container revisions would fail their probe.

```
SATURN/
├─ frontend/                 React + TypeScript + Vite + Three.js + Zustand + CSS Modules
│  └─ src/
│     ├─ globe/              custom Three.js Earth (GlobeScene, textures, controller)
│     ├─ uiActions/          Zod action schema + the single UIActionExecutor
│     ├─ state/              Zustand store (single source of truth)
│     ├─ components/         HUD: clock, panels, readout strip, command bar, drawers, loader
│     ├─ hooks/              agent SSE bridge, voice I/O
│     ├─ api/                typed backend client
│     ├─ geo/                coordinate maths + unit tests
│     └─ styles/             design tokens + console composition (1456×720 design canvas)
├─ backend/                  FastAPI + Pydantic + httpx + Google Gen AI SDK (Vertex AI)
│  ├─ app/
│  │  ├─ main.py             API routes
│  │  ├─ agent/              orchestrator + Vertex/mock model clients + prompt
│  │  ├─ tools/              typed tool registry (geo, imagery, events, UI actions)
│  │  ├─ ui_actions/         Pydantic mirror of the UI action schema
│  │  ├─ geo/                Nominatim client + location resolution + coordinates
│  │  ├─ imagery/gibs.py     NASA GIBS WMTS adapter (capabilities, dates, tile plans)
│  │  ├─ events/             NASA EONET + NASA FIRMS adapters
│  │  └─ tasks.py            task bus: SSE stream, UI-action ACK round-trip, cancellation
│  └─ tests/                 54 offline tests + opt-in live-network tests
├─ scripts/                  dev launcher, screenshots, UI-action E2E, agent demo
├─ docs/                     architecture, API, data sources, security, mobile, roadmap
├─ .env.example
└─ README.md
```

---

## 2. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Node.js | 20+ (tested on 24) | Vite 6, React 18 |
| Python | 3.11 (tested 3.11.9) | FastAPI, google-genai |
| Chrome / Edge | latest | WebGL + Web Speech API |
| (optional) Google Cloud project with Vertex AI enabled | — | for the real LLM agent |

No API key is needed for the demo: Nominatim, GIBS and EONET are key-free. FIRMS needs a
`MAP_KEY`; without it the fire overlay honestly reports **UNAVAILABLE**.

---

## 3. Setup (Windows PowerShell)

```powershell
cd SATURN

# 1. environment
Copy-Item .env.example .env
#    edit .env if you have a Vertex AI project / FIRMS key

# 2. backend
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..

# 3. frontend
cd frontend
npm install
cd ..

# 4. run both (two windows: API on :8787, UI on :5173)
.\scripts\dev.ps1
```

Open **http://localhost:5173**.

Manual alternative:

```powershell
# terminal 1
cd SATURN\backend ; .\.venv\Scripts\python.exe run.py
# terminal 2
cd SATURN\frontend ; npm run dev
```

Linux / macOS:

```bash
cd SATURN
cp .env.example .env
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..
(cd backend && .venv/bin/python run.py) & (cd frontend && npm run dev)
```

Stop everything: `.\scripts\stop.ps1` (or close the two windows).

`?noboot=1` on the URL skips the intro animation (useful for screenshots/automation).

---

## 4. Configuration

All settings live in `.env` (copy of `.env.example`). **Secrets never reach the browser.**

| Variable | Purpose |
|---|---|
| `CORS_ORIGINS` | allowed browser origins (default `http://localhost:5173`) |
| `GOOGLE_CLOUD_PROJECT` | enables the Vertex AI agent; blank ⇒ deterministic mock model |
| `GOOGLE_CLOUD_LOCATION` | Vertex region (default `us-central1`) |
| `VERTEX_MODEL` | model id passed to the SDK (e.g. `gemini-2.5-flash`) — confirm availability in your project |
| `SATURN_FORCE_MOCK_LLM=1` | force mock mode even with a project configured |
| `NOMINATIM_USER_AGENT` | **required by the OSM policy** — put a real contact address here |
| `NOMINATIM_MIN_INTERVAL_S` | request spacing (default 1.0 s, policy compliant) |
| `FIRMS_MAP_KEY` | enables `POST /api/fires` and the fire overlay |
| `VITE_API_BASE` | frontend API base (default `/api`) |

Vertex AI uses **Application Default Credentials**:

```powershell
gcloud auth application-default login
gcloud services enable aiplatform.googleapis.com
```

Then set `GOOGLE_CLOUD_PROJECT` (and optionally `VERTEX_MODEL`) and restart the backend.
`GET /api/agent/config` and the SYSTEM STATUS panel show which mode is active
(`VERTEX` vs `MOCK`).

### 4.1 Step-by-step: enabling the real Vertex AI agent

Do these once. Nothing here is committed to the repo; credentials stay on your machine and on
the server, never in the browser.

1. **Create / pick a Google Cloud project**

   ```powershell
   gcloud auth login
   gcloud projects list
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **Enable billing and the Vertex AI API** (the API refuses to serve without billing)

   ```powershell
   gcloud services enable aiplatform.googleapis.com
   ```

3. **Log in with Application Default Credentials** — this is what the backend reads. It writes a
   local credential file; no key is ever placed in `.env`.

   ```powershell
   gcloud auth application-default login
   gcloud auth application-default set-quota-project YOUR_PROJECT_ID
   ```

4. **Grant your account the Vertex AI role** (usually already present for project owners)

   ```powershell
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID `
     --member="user:YOUR_EMAIL" --role="roles/aiplatform.user"
   ```

5. **Confirm the model ID actually exists in your project.** Model availability differs by region;
   list what you have rather than assuming:

   ```powershell
   gcloud ai models list --region=us-central1
   ```

   For Gemini models on Vertex, the IDs look like `gemini-2.5-flash` or `gemini-2.0-flash-001`.
   Set whichever you confirmed:

   ```powershell
   VERTEX_MODEL=gemini-2.5-flash
   ```

   > If you are unsure, leave `VERTEX_MODEL` blank and check `GET /api/agent/config` after starting —
   > the backend reports the model it will use.

6. **Edit `.env`** at the repo root:

   ```ini
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_CLOUD_LOCATION=us-central1
   VERTEX_MODEL=gemini-2.5-flash
   ```

7. **Restart the backend** and verify the mode flipped from MOCK to VERTEX:

   ```powershell
   cd SATURN\backend ; .\.venv\Scripts\python.exe run.py
   # in another window:
   Invoke-RestMethod http://127.0.0.1:8787/api/agent/config
   ```

   Expected: `"mode": "vertex"`. If it still says `"mock"`, the usual causes are
   (a) `GOOGLE_CLOUD_PROJECT` unset in the shell that started the process,
   (b) ADC not logged in, or (c) `SATURN_FORCE_MOCK_LLM=1` still present.

8. **Run the core workflow** — type into the command bar or call the API:

   ```powershell
   Invoke-RestMethod -Uri http://127.0.0.1:8787/api/agent/command -Method Post `
     -ContentType "application/json" `
     -Body '{"text":"Show South Korea and display the latest suitable satellite imagery"}'
   ```

   The response contains a `task_id`; progress arrives over
   `GET /api/tasks/{task_id}/events` (SSE). With the UI open, the agent drives the globe and the
   panels acknowledge each action.

9. **Troubleshooting**

   | Symptom | Cause | Fix |
   |---|---|---|
   | `403 PERMISSION_DENIED` / quota | billing off, or no `aiplatform.user` role | steps 2 and 4 |
   | `Could not load the default credentials` | ADC not logged in | step 3 |
   | `404 model not found` | wrong model ID for that region | step 5, then set `VERTEX_MODEL` |
   | Agent replies but never moves the globe | UI not open, so no ACK arrives | open http://localhost:5173 |
   | Reply says "UI did not acknowledge" | no browser attached to the task | expected in headless calls |

   Cost note: each command makes a small number of model calls. For free/demo use, keep
   `SATURN_FORCE_MOCK_LLM=1` — mock mode still calls the real geo and NASA tools.

Mock mode is not a fake UI: the mock planner still calls the **real** geo/imagery tools, so you
get real locations, real GIBS metadata and real tiles — only the natural-language planning is
deterministic. Every mock reply is labelled as such at boot.

---

## 5. How to use it

Commands (type in the command bar or press the mic):

| Try this | What happens |
|---|---|
| `Show South Korea and display the latest suitable satellite imagery` | resolve → outline → fly → real GIBS layer + latest valid date → panels update → sourced reply |
| `Take me to Seoul.` | resolve + fly |
| `Zoom into the Amazon rainforest.` | resolve + fly to bbox |
| `Set opacity to 50 percent.` | UI action `set_layer_opacity` |
| `Turn off boundaries.` | UI action `toggle_map_overlay` |
| `Go back to the global view.` | `restore_global_view` |
| `Compare this area with last month` | swipe comparison of two **real** dates (no change analysis claimed) |
| `Show wildfire observations around southern Europe` | EONET/FIRMS (FIRMS needs the key) |

Keyboard: `Enter` send · `/` focus command bar · `Esc` stop listening.

Voice: click the mic (push-to-talk) — the browser's speech service is used; a note is shown while
listening. Replies are spoken **only** when you unmute (`MUTE` → `VOICE`). Wake-word listening
needs a dedicated engine (e.g. Porcupine) with a licence key; without one the app says so instead
of pretending.

---

## 6. Testing

```powershell
# backend — 54 offline tests (provider HTTP mocked)
cd SATURN\backend
.\.venv\Scripts\python.exe -m pytest -q

# backend — opt-in LIVE provider tests (Nominatim + GIBS, rate-limited)
$env:SATURN_REAL_NETWORK=1
.\.venv\Scripts\python.exe -m pytest tests/test_real_network.py -v
Remove-Item Env:SATURN_REAL_NETWORK

# frontend — coordinate maths + UI action schema
cd SATURN\frontend
npx vitest run

# type-check / production build
npx tsc -b --pretty false
npm run build
```

Browser automation (needs `npx playwright install chromium` once, in `scripts/`):

```powershell
cd SATURN
node scripts\shoot.js     http://localhost:5173 docs\reference\saturn-1456.png 1456 720 6000
node scripts\e2e.js                                         # every UI action from the debug console
node scripts\agent-demo.js "Show South Korea and display the latest suitable satellite imagery"
node scripts\compare.js                                     # docs/reference/compare.png
```

---

## 7. Controls the agent can drive (UI Action Registry)

`navigate_globe`, `set_camera_view`, `restore_global_view`, `highlight_location`,
`set_imagery_layer`, `set_observation_date`, `set_layer_opacity`, `toggle_map_overlay`,
`select_dropdown`, `set_slider`, `toggle_checkbox`, `open_panel`, `close_panel`,
`select_region_card`, `save_region`, `start_timeline_playback`, `compare_dates`, `focus_event`,
`clear_all`, `inspect_globe_state`.

Humans and the agent use the **same** executor (Zod validated) writing to the **same** Zustand
store. Agent actions travel over SSE, are executed in the browser and acknowledged back;
`AGENT CONTROLLING` + `STOP` cancel the task and pending actions.

Debug console:

```js
await window.saturn.uiActions.debug('navigate_globe', { lat: 51.5, lon: -0.12, altitude_km: 2500 });
await window.saturn.uiActions.debug('inspect_globe_state', {});
```

---

## 8. Honesty & provenance rules implemented

* `VEL` is the camera's real ground-track speed (0 when idle); `TEMP` shows `N/A` — no weather
  connector is configured, so no number is invented.
* Base sphere = **synthetic texture**, labelled “BASE TEXTURE — NOT SATELLITE OBSERVATION”.
* Dotted map, node network, rings and sweep are labelled **decorative** in the Layers panel.
* GIBS products are **daily composites** with a ~1-day ingest lag; the freshness badge is
  `RECENT OBSERVATION` (≤3 days) or `HISTORICAL`; the words “live” are avoided.
* FIRMS detections are labelled **thermal anomalies, not confirmed wildfires**.
* Ambiguous geocoding returns ranked candidates and asks a clarifying question; outlines are
  marked exact or approximate.
* Missing credentials produce explicit errors (`quota`, `credentials`, `timeout`), never fake data.

---

## 9. Known limitations

* **Reference image not in the repo.** `docs/reference/ui-reference.png` must be dropped in by
  you; `scripts/compare.js` then produces the side-by-side diff.
* Split-view comparison currently opens the state and the UI handles the two dates; the swipe
  shader is a follow-up.
* Saved investigations / auth (Firebase) and PWA/mobile polish are Phase 8 work — not built yet;
  the HISTORY drawer says so.
* Mobile browsers cannot listen for voice in the background; wake word requires an engine + key.
* `google-genai` Vertex path is implemented but has not been run against a live project here
  (no credentials on this machine); mock mode is fully verified.
* NASA GIBS acknowledged as the imagery source; OSM data © OpenStreetMap contributors (ODbL).

---

## 10. Docs

[ARCHITECTURE](docs/ARCHITECTURE.md) · [API](docs/API.md) · [DATA SOURCES](docs/DATA_SOURCES.md) ·
[SECURITY](docs/SECURITY.md) · [MOBILE](docs/MOBILE.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) ·
[ROADMAP](docs/DEVELOPMENT_ROADMAP.md)

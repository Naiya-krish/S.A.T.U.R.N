# S.A.T.U.R.N. — Architecture

## 1. System overview

```mermaid
flowchart LR
  subgraph Browser["Browser — React 18 / Vite / Three.js / Zustand"]
    UI["HUD panels, command bar\n(SearchBox, ReadoutStrip, RightColumn ...)"]
    EX["UIActionExecutor\n(Zod validated) — single writer"]
    ST["Zustand store"]
    GL["GlobeScene (Three.js)\ncustom Earth, tiles, overlays"]
    AG["Agent stream hook\n(EventSource SSE)"]
    VO["Voice I/O\n(SpeechRecognition / speechSynthesis)"]
    UI -->|human click| EX
    EX --> ST
    EX --> GL
    ST --> UI
    ST --> GL
    AG -->|UIAction JSON| EX
    AG -->|POST ack| API
    VO -->|text| AG
    UI -->|text| AG
  end

  subgraph Server["FastAPI backend — :8787"]
    API["/api/agent/command\n/api/tasks/{id}/events\n/api/ui-actions/{id}/ack"]
    ORCH["AgentOrchestrator\nlimits · retries · cancellation"]
    TOOLS["Tool registry\ntyped inputs · permission · timeout"]
    GEO["Location service\n(Nominatim + cache + 1 req/s)"]
    GIBS["NASA GIBS WMDB adapter\n(capabilities, dates, tile plans)"]
    EVT["EONET / FIRMS adapters"]
  end

  subgraph Cloud["External providers"]
    VX["Vertex AI\n(Google Gen AI SDK · ADC)"]
    NOM["OpenStreetMap Nominatim"]
    G["NASA GIBS WMTS"]
    E["NASA EONET"]
    F["NASA FIRMS (MAP_KEY)"]
  end

  ORCH <--> VX
  ORCH --> TOOLS
  TOOLS --> GEO --> NOM
  TOOLS --> GIBS --> G
  TOOLS --> EVT --> E
  EVT --> F
  GIBS -->|tile URLs| Browser
```

## 2. Command lifecycle (agent-controlled UI)

```mermaid
sequenceDiagram
  participant U as Operator
  participant FE as Frontend
  participant BE as Backend
  participant M as Model (Vertex/Mock)
  participant P as Providers

  U->>FE: "Show South Korea ... imagery"
  FE->>BE: POST /api/agent/command
  BE-->>FE: { task_id }
  FE->>BE: GET /api/tasks/{id}/events (SSE)
  BE->>M: compact state snapshot + tools
  M-->>BE: tool_call resolve_location
  BE->>P: Nominatim search (+details)
  M-->>BE: tool_call fly_to_location
  BE-->>FE: ui_action highlight_location
  FE->>FE: executor → camera + outline
  FE->>BE: POST /api/ui-actions/{action}/ack (executed)
  BE-->>FE: ui_action navigate_globe
  FE->>BE: ack
  M-->>BE: tool_call show_satellite_imagery
  BE->>P: GIBS dates + tile plan
  BE-->>FE: ui_action set_imagery_layer / set_observation_date
  FE->>BE: ack (tiles requested)
  M-->>BE: final answer with source + date
  BE-->>FE: result + status completed
```

The model never claims an action happened before the browser ACK arrives. `STOP` cancels the
task, unblocks pending actions and tells the browser to stop executing new ones.

## 3. Frontend structure

| Layer | Files | Responsibility |
|---|---|---|
| Design system | `styles/theme.css`, `styles/console.module.css`, `styles/loader.module.css` | tokens sampled from the reference; 1456×720 design canvas scaled by `--scale` |
| Globe | `globe/GlobeScene.ts`, `globe/GlobeController.ts`, `globe/textures.ts` | custom Three.js Earth, orbit controls, flyTo, tiles, overlays, labels |
| State | `state/useSaturnStore.ts` | camera, layers, overlays, regions, agent, logs, panels |
| Commands | `uiActions/schema.ts`, `uiActions/executor.ts` | Zod contract + the only state writer for both humans and agent |
| Transport | `api/client.ts`, `hooks/useAgentStream.ts` | typed REST + SSE, ACK round-trip |
| Voice | `hooks/useVoice.ts` | push-to-talk, TTS, graceful fallbacks |
| UI | `components/**` | panels, readout strip, command bar, drawers, loader, mobile shell |

Scaling: the three HUD columns and the readout strip are absolutely positioned in the design canvas
(identical proportions to the reference at any resolution); the globe host sits behind the panels.

## 4. Backend structure

| Module | Responsibility |
|---|---|
| `main.py` | routes, CORS, request-id middleware, error mapping |
| `tasks.py` | task bus: event history, SSE fan-out, action ACK futures, cancellation |
| `agent/orchestrator.py` | plan → tools → UI actions → reply, with limits and retries |
| `agent/model_client.py` | `VertexModel` (google-genai, ADC) and deterministic `MockModel` |
| `tools/registry.py` | typed tools with permission level, timeout and honest error format |
| `ui_actions/registry.py` | Pydantic mirror of the Zod schema + argument validation |
| `geo/*` | coordinate maths, Nominatim client (cache + throttle), resolution workflow |
| `imagery/gibs.py` | WMTS capabilities parsing, curated layer set, date validation, tile plans |
| `events/*` | EONET normalisation, FIRMS CSV parsing with explicit "not configured" state |
| `auth.py` | tri-state identity: Firebase ID-token verification, demo, disabled |
| `store.py` | saved regions/views/prefs under `users/{uid}`, Firestore or in-memory |
| `ratelimit.py` | per-user / per-IP token bucket with `Retry-After` |

## 4.1 Authentication and saved data (Phase 8)

```mermaid
flowchart LR
  B[Browser] -->|ID token| API[/api/me/**]
  API --> AUTH{auth_mode}
  AUTH -->|firebase| V[Verify with Firebase Admin SDK]
  AUTH -->|demo| D[Shared demo identity]
  AUTH -->|disabled| X[503]
  V --> UID[uid from token]
  UID --> ST[store: users/uid/...]
  ST -->|project configured| FS[(Firestore)]
  ST -->|no project| MEM[(process memory)]
```

Three rules keep this honest:

1. **The uid comes from the token, never the request body.** There is no code path that can
   address another user's collection, and Firestore rules enforce the same boundary for direct
   client access.
2. **The mode is always published.** `/api/auth/config` reports `mode`, `storage` and
   `persistent`, and the notice text changes to match. If accounts exist but storage is in-memory,
   the notice says the data is lost on restart rather than inviting the user to save.
3. **Verification fails closed.** If the Admin SDK or credentials are unavailable the request is
   rejected with 401; an unverified token is never trusted.

## 5. Data-ownership rules

1. The browser owns *presentation* state; the backend owns *provider* access and the model.
2. No secret is ever sent to the browser.
3. The model receives a compact snapshot (`state_snapshot_text`), never imagery or full history.
4. Every provider result carries `Provenance` (provider, product, observation time, retrieval
   time, freshness, attribution).

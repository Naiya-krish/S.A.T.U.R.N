# Security model

## Secrets

* `FIRMS_MAP_KEY`, Vertex project settings and the Nominatim contact live **only** on the server.
  `.env` is git-ignored; only `.env.example` is committed.
* Vertex AI authenticates with **Application Default Credentials**. Locally that is
  `gcloud auth application-default login`; in Cloud Run it is the service identity. No
  service-account JSON is ever bundled or committed.
* The frontend only receives public values: `VITE_API_BASE` and the Firebase **web** config
  (which identifies a project but authorises nothing).
* In production the FIRMS key comes from **Secret Manager** via `secretKeyRef`, never an env file.

## Authentication (Phase 8)

Auth is a **tri-state** and never overstates itself. `GET /api/auth/config` publishes which
mode is active, and the UI renders exactly that:

| Mode | When | Behaviour |
|---|---|---|
| `firebase` | `GOOGLE_CLOUD_PROJECT` + Firebase enabled | ID tokens required on `/api/me/**`; verified server-side |
| `demo` | no project configured | no accounts; one shared sandbox identity; responses and UI say **saved data is not private** |
| `disabled` | `SATURN_AUTH=disabled` | protected routes return 503 |

Verification rules:

* Tokens are verified with the Firebase **Admin SDK** (Google's public keys, issuer, audience,
  expiry). If the SDK or credentials are unavailable the request **fails closed with 401** —
  an unverified token is never trusted.
* The browser never holds a service account.
* In `demo` mode a bearer token is explicitly **rejected**, so a client cannot believe it is
  authenticated when it is not.
* Verified identities are cached briefly (SHA-256 of the token, 5 min, bounded) to avoid
  re-verifying on every poll. Cache entries are never logged.

## Data isolation

Saved regions, views and preferences are stored under a **per-user path**:

```
saturn/users/{uid}/regions/{id}
saturn/users/{uid}/views/{id}
saturn/users/{uid}/prefs/prefs
```

* `uid` always comes from a verified token, never from the request body.
* There is no code path that can address another user's collection.
* Firestore rules (`firestore.rules`) enforce the same boundary for any direct client access:
  default deny, then `request.auth.uid == uid` only, with shape validation.
* Right to erasure: `DELETE /api/me/data` removes every document for the caller.

Covered by tests: `backend/tests/test_phase8_auth.py` (cross-user read, cross-user delete,
isolation of views and prefs, erasure scoping) and `frontend/firestore-rules.test.ts` (emulator).

## Rate limiting

* Token bucket per user (or per client IP when anonymous).
* Defaults: 30 requests/minute, burst 10 — configurable via `RATE_LIMIT_PER_MINUTE` /
  `RATE_LIMIT_BURST`.
* Returns `429` with `Retry-After` and `X-RateLimit-*` headers.
* The limiter runs **after** authentication, so a rejected request never burns a caller's quota.
* Limitation: buckets are process-local. Scaling horizontally needs a shared store (e.g. Redis);
  the interface is a single `check()` call so that swap is contained.

## Browser ↔ backend

* CORS is restricted to `CORS_ORIGINS`. In production the app is served from the same origin via
  the Hosting `/api/**` rewrite, so CORS is not exercised at all.
* No cookies or ambient credentials (`allow_credentials=False`); authentication is an explicit
  `Authorization` header.
* Every response carries `X-Request-ID`; logs are structured JSON.

## Agent safety

* The model can only call **typed tools**. No shell, no filesystem, no arbitrary HTTP, no code
  execution.
* Every UI action argument is validated twice: Zod in the browser, Pydantic on the server.
* Limits: `agent_max_tool_calls` (default 8), per-tool timeout 25 s, overall timeout 120 s,
  bounded retries with backoff.
* The model sees a compact state snapshot, never imagery; hidden reasoning is not logged.
* `STOP` / `POST /api/tasks/{id}/cancel` cancels the task and stops pending actions.
* Tool arguments are sanitised (`thought` / `reasoning` keys stripped).

## PWA and caching

* The service worker caches the **app shell only**.
* `/api/**`, any request with an `Authorization` header, GIBS tiles, NASA endpoints and
  Nominatim are **network-only** — never cached, never replayed.
* Rationale: private responses must not leak between users on a shared device, and stale imagery
  must never be presented as current.
* `sw.js` is served with `no-store` so updates roll out promptly.
* Verified by `scripts/pwa-check.js`: asserts 0 API and 0 tile entries in the cache.

## Provider etiquette

* **Nominatim**: descriptive User-Agent with a real contact (`NOMINATIM_USER_AGENT`), one
  request per second enforced with a global lock, responses cached. Compliant with the OSM
  usage policy.
* **GIBS**: capabilities cached (6 h); tile URLs are fetched by the browser directly, so no
  imagery is proxied through the API and no key is involved.

## Threat notes

| Threat | Mitigation |
|---|---|
| Forged identity | Server-side token verification; fails closed |
| Reading another user's saves | Per-user paths + Firestore rules; tested |
| Cost abuse of the LLM | Rate limits, tool-call caps, timeouts, mock mode for demos |
| Prompt-injection via place names | Tool args are typed and validated; the model cannot execute code |
| Stale imagery shown as live | Freshness badges; no caching of tiles; "not live" wording |
| Secrets in the bundle | Only public Vite vars; secrets stay server-side |

## Known gaps

* No email verification or MFA enforcement beyond what Firebase provides by default.
* No WAF/bot protection — front a public deployment with Cloud Armor if it is widely shared.
* Limiter is per-instance (see above).

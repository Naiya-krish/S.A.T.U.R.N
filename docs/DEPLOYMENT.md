# Deployment

> **Nothing here has been deployed.** These are the exact steps and configs to
> run yourself. No command below is executed automatically by the project.

Target topology:

```
  browser ──► Firebase Hosting  ──/api/**──►  Cloud Run (saturn-api, :8080)
                    │                              │
                    └── static app shell           ├─► Vertex AI (ADC)
                                                   ├─► Firestore (Admin SDK)
                                                   ├─► NASA GIBS / EONET / FIRMS
                                                   └─► Nominatim
```

One origin in production: Hosting rewrites `/api/**` to Cloud Run, so CORS is
never exercised by the real app and SSE has no cross-origin preflight.

---

## 0. One-time setup

```bash
PROJECT=your-project-id
gcloud config set project "$PROJECT"

# APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com

# Service identity for Cloud Run
gcloud iam service-accounts create saturn-run \
  --display-name="SATURN Cloud Run runtime"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:saturn-run@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:saturn-run@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Container registry
gcloud artifacts repositories create saturn \
  --repository-format=docker --location=us-central1
```

## 1. Secrets (never in env files or the repo)

```bash
# NASA FIRMS map key
printf 'YOUR_FIRMS_KEY' | gcloud secrets create firms-map-key --data-file=-

# Grant the runtime identity read access
gcloud secrets add-iam-policy-binding firms-map-key \
  --member="serviceAccount:saturn-run@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

`.env` is git-ignored. Nothing secret is baked into the image; Vertex AI uses the
Cloud Run service identity via Application Default Credentials.

## 2. Build and push the backend image

```bash
IMAGE=us-central1-docker.pkg.dev/$PROJECT/saturn/saturn-api:latest
gcloud builds submit --tag "$IMAGE" --file Dockerfile .
```

## 3. Deploy to Cloud Run

Edit `deploy/cloudrun.yaml`, replacing every `PROJECT_ID` with your project.

```bash
gcloud run services replace deploy/cloudrun.yaml --region us-central1
```

Important settings already in that manifest:

| Setting | Why |
|---|---|
| `timeoutSeconds: 300` | agent tasks + streaming responses |
| `containerConcurrency: 40` | SSE streams hold a connection open |
| `minScale: 0`, `maxScale: 4` | cost control; cold start ~3 s |
| `startupProbe /api/health` | probes real readiness, not just the port |
| `serviceAccountName` | ADC for Vertex AI + Firestore |
| `FIRMS_MAP_KEY` via `secretKeyRef` | no plaintext secret |
| `CORS_ORIGINS` = Hosting origins | production CORS is narrow |

SSE needs no special proxy config on Cloud Run, but **any CDN or proxy in front
of it must not buffer**. Firebase Hosting passes streaming responses through;
verify with:

```bash
curl -N https://$PROJECT.web.app/api/tasks/TASK_ID/events
```

## 4. Firestore

```bash
gcloud firestore databases create --location=us-central1

# Deploy the least-privilege rules
firebase deploy --only firestore:rules
```

Rules live in `firestore.rules`: everything is denied by default, and a user may
only touch `saturn/users/{their-own-uid}/{regions|views|prefs}`. The backend
uses the Admin SDK, which bypasses rules, so server writes still work.

## 5. Frontend to Firebase Hosting

```bash
# Public Firebase web config (these values are not secrets)
cd frontend
cat > .env.production <<'EOF'
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=1:...
EOF

npm ci
npm run build
cd ..
firebase deploy --only hosting
```

`firebase.json` already contains the `/api/**` → Cloud Run rewrite, SPA
fallback, security headers, immutable caching for hashed assets, and
`Cache-Control: no-store` for `sw.js` so service-worker updates roll out.

## 6. Verification after deploy

```bash
SITE=https://your-project.web.app

curl -s $SITE/api/health | jq
curl -s $SITE/api/agent/config | jq      # expect "mode": "vertex"
curl -s $SITE/api/auth/config | jq       # expect "mode": "firebase"
```

Then in the browser:

1. The UI loads and the globe renders.
2. The auth chip shows a sign-in button, not a demo badge.
3. Sign in, save a region, then delete it.
4. Run: *"Show South Korea and display the latest suitable satellite imagery"* —
   the globe flies there and real tiles appear with provider/date/provenance.
5. Install the PWA (browser install icon), then go offline: the shell loads and
   the offline banner appears.
6. Sign in as a second account and confirm the first account's saved regions are
   not visible.

---

## Rolling back

```bash
gcloud run revisions list --service saturn-api --region us-central1
gcloud run services update-traffic saturn-api \
  --to-revisions=REVISION_NAME=100 --region us-central1
```

Hosting keeps the previous release:

```bash
firebase hosting:rollback
```

---

## Cost notes

* Cloud Run scales to zero; idle cost is storage only.
* Vertex AI is billed per token. Keep `SATURN_FORCE_MOCK_LLM=1` for demos — mock
  mode still calls the real geo and NASA tools, so the product is fully
  exercisable without model spend.
* Firestore free tier covers light personal use; reads dominate.
* GIBS/Nominatim/EONET are free but rate-limited. Nominatim policy requires a
  real contact address in `NOMINATIM_USER_AGENT` and at most 1 request/second —
  both enforced in the backend.

## Pre-launch checklist

- [ ] `CORS_ORIGINS` lists only the production Hosting origins
- [ ] `NOMINATIM_USER_AGENT` contains a real contact email
- [ ] FIRMS key in Secret Manager, not in env
- [ ] `VERTEX_MODEL` confirmed to exist in the chosen region
- [ ] Firestore rules deployed and rules tests passing against the emulator
- [ ] Rate limits sized for expected traffic (`RATE_LIMIT_PER_MINUTE`)
- [ ] SSE verified through the Hosting rewrite (no buffering)
- [ ] Mobile layout checked in portrait and landscape
- [ ] `/api/auth/config` reports the intended mode

<div align="center">
<img width="1200" height="475" alt="Legacy Smelter" src="https://repository-images.githubusercontent.com/1201373945/f2802097-2afe-4c31-848f-a94cc13ca0b1" />
</div>

# Legacy Smelter

A satirical incident reporting system for condemned digital artifacts. Upload an image. Hotfix processes it. Output: molten slag.

The system analyzes uploaded images using Gemini Vision and files a formal postmortem — classification, severity, failure origin, disposition, archive note — before thermally decommissioning the artifact via dragon-based remediation.

## Features

- **Gemini Vision analysis** — 16-field structured incident schema delivered via Gemini's constrained JSON mode
- **Hotfix animation** — PixiJS dragon idle, fly-in, and smelt sequence with audio
- **Incident postmortem** — full structured report overlay with social share (X, Bluesky, Reddit, LinkedIn) plus copy-link
- **Global incident manifest** — real-time Firestore feed of all thermally decommissioned artifacts
- **Decommission index** — live cumulative pixel count across all incidents
- **Camera support** — deploy field scanner via device camera or file upload

## Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript + Vite |
| Animation | PixiJS 8 |
| AI | Gemini (`gemini-3.1-flash-lite-preview`) via `@google/genai` |
| Database | Firebase Firestore |
| Audio | Howler.js |
| Styling | Tailwind CSS v4 |

## Run locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Create `.env` from `.env.example` and set your server-side Gemini API key:
   ```
   cp .env.example .env
   GEMINI_API_KEY=your_key_here
   ```
3. Start the API server (terminal 1):
   ```
   make server
   ```
4. Start the Vite dev server (terminal 2):
   ```
   npm run dev
   ```

The app runs at `http://localhost:3000`.

## Project structure

```
src/
├── App.tsx                          Main smelter page
├── main.tsx                         Root + hash-based page routing
├── types.ts                         SmeltLog + GlobalStats types
├── firebase.ts                      Firestore client
├── components/
│   ├── SmelterCanvas.tsx            PixiJS dragon animation
│   ├── IncidentReportOverlay.tsx    Postmortem modal + share
│   ├── IncidentManifest.tsx         Global incident manifest page
│   ├── IncidentLogCard.tsx          Shared incident log card
│   ├── DataHealthIndicator.tsx      Data integrity indicator
│   ├── DecommissionIndex.tsx        Cumulative pixel decommission counter
│   └── SiteFooter.tsx               Site footer
├── hooks/
│   └── useEscalation.ts             Escalation vote state
├── services/
│   ├── geminiService.ts             Gemini prompt, schema, analysis
│   ├── escalationService.ts         Escalation vote writes
│   └── breachService.ts             Breach tracking writes
└── lib/
    ├── utils.ts                     Pixel formatting + color utilities
    ├── firestoreErrors.ts           Firestore error handling
    ├── smeltLogSchema.ts            Strict SmeltLog schema + parser
    ├── animationWindow.ts           Animation timing utilities
    ├── storageJson.ts               LocalStorage helpers
    └── typeGuards.ts                Runtime type guards
shared/
├── impactScore.js                   Impact score formula (IMPACT_WEIGHTS, computeImpactScore)
├── colors.js                        Fallback color palette
└── admin-init.js                    Firebase Admin SDK initialization
scripts/
├── backfill-voting-fields.ts        Voting fields backfill migration
└── firestore.rules.integration.test.ts  Firestore rules integration tests
docs/
├── classification-prompt.md         AI generation constraints and field spec
├── ux-copy.md                       Voice, persona, and copy rules
├── design-decisions.md              Deliberate spec deviations
├── sanction-rebuild-prompt.md       Sanction system rebuild build brief
└── archive/
    ├── judging-prompt.md            Original sanction judging prompt (superseded)
    ├── gemini-implementation-and-share-spec.md  Original Gemini spec (superseded)
    └── original-ai-studio-prompt.md             Original AI Studio scaffold prompt
```

## Docs

- [`docs/classification-prompt.md`](docs/archive/classification-prompt.md) — AI prompt, severity tiers, field constraints
- [`docs/ux-copy.md`](docs/ux-copy.md) — Voice, persona rules, writing constraints for UI and AI copy
- [`docs/design-decisions.md`](docs/design-decisions.md) — Deliberate deviations from the original spec and their rationale
- [`docs/sanction-judging-patch.md`](docs/sanction-judging-patch.md) — Sanction system rebuild build brief

## Operations

### Deploy

```bash
# Cloud Run (Express server + client)
make deploy                         # uses .env, deploys to gcloud default project
./deploy.sh --env-file .env.staging # specific env file

# Firebase functions only
firebase deploy --only functions --project anchildress1-unstable
```

### Sanction judging

The `onIncidentCreated` Cloud Function fires on every `incident_logs` document create. It batches 5 unevaluated incidents, asks Gemini to pick one winner, and commits the result. Fewer than 5 unevaluated → no-op.

**Manually trigger a sanction batch** (without creating a new incident):

```bash
curl -s -X POST "https://onincidentcreated-u36ut3r63a-ue.a.run.app" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token --project=anchildress1-unstable)" \
  -H "Content-Type: application/json" \
  -H "ce-id: manual-$(date +%s)" \
  -H "ce-source: //firestore.googleapis.com/projects/anchildress1-unstable/databases/legacy-smelter" \
  -H "ce-type: google.cloud.firestore.document.v1.created" \
  -H "ce-specversion: 1.0" \
  -H "ce-datacontenttype: application/json" \
  -H "ce-time: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -H "ce-subject: documents/incident_logs/manual-trigger" \
  -d '{"value":{"name":"projects/anchildress1-unstable/databases/legacy-smelter/documents/incident_logs/manual-trigger","fields":{"evaluated":{"booleanValue":false}}}}'
```

Returns `204` on success. The function independently queries Firestore for unevaluated docs — the event payload is just a gate.

**Check function logs:**

```bash
gcloud functions logs read onIncidentCreated \
  --gen2 --region=us-east1 --project=anchildress1-unstable --limit=15
```

**Key fields per incident doc:**

| Field | Type | Written by | Purpose |
|-------|------|-----------|---------|
| `evaluated` | boolean | server.js (false) → sanction.js (true) | Claim flag — `false` = eligible for judging |
| `sanction_lease_at` | timestamp/null | sanction.js | Claim lease; swept after 5 min TTL |
| `sanctioned` | boolean | sanction.js | Winner flag |
| `sanction_rationale` | string/null | sanction.js | Gemini's one-sentence justification |
| `sanction_count` | number | sanction.js | 0 or 1, used in impact_score formula |
| `impact_score` | number | sanction.js | `5×sanction + 3×escalation + 2×breach` |

### Emulator (local dev)

Three terminals:

```bash
make functions  # Firebase emulator: auth:9099, firestore:9180, functions:5001
make server     # Express API on :8080
make dev        # Vite on :3000 (proxies /api → :8080)
```

Requires `VITE_USE_FIREBASE_EMULATOR="true"` and `FIRESTORE_EMULATOR_HOST="127.0.0.1:9180"` in `.env`. The server auto-pairs `FIREBASE_AUTH_EMULATOR_HOST` from the Firestore host.

## License

[Polyform Shield 1.0.0](LICENSE) — free to use, fork, and adapt; no monetization without permission.

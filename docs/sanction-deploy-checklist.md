# Sanction judging — deploy checklist

**Status:** Permanent. Follow this on every sanction-touching deploy, not just the initial rebuild. Pair with `docs/sanction-system-design.md` for the architectural context and `docs/sanction-test-plan.md` for the green-before-deploy gate.

This checklist has three phases: **unstable preflight**, **unstable smoke**, and **prod rollout**. The prod phase is gated on explicit user sign-off after the unstable smoke passes.

## Conventions

- Two Firebase projects: `anchildress1-unstable` (default target) and `anchildress1` (prod). Per `feedback_firebase_deploy_unstable_only`, every command defaults to unstable only and prod requires explicit user ask.
- Functions codebase: `default`, source `functions/`, runtime `nodejs22`. Declared in `firebase.json`.
- Region: `us-east1` — pinned to both the Firestore database region and the Cloud Run service region. If Firestore moves, the function has to move with it.
- Database: named database `legacy-smelter`, not `(default)`.

## 0. Green-before-deploy gate

Do NOT proceed past this point if any of these return non-zero:

```bash
npm run test                 # 204 unit tests, mocked admin + Gemini
npm run test:api:emulator    # 12 emulator-backed tests across 2 suites
npm run typecheck            # tsc --noEmit across ts sources
```

If CI is red, fix CI before deploying. No deploy-through-red-CI.

## 1. Preflight MCP verification

Run these BEFORE touching any `firebase deploy` command. Report results back to the user.

### 1.1 Firestore region check — both projects

Target region for the function is `us-east1`. Both Firestore databases must be in `us-east1` (or a compatible region that supports Eventarc triggers). If either is mismatched, **abort** — the function will deploy, but the Eventarc trigger subscription will be cross-region and failure modes become silent.

Primary path: Firebase MCP `firestore_get_database` (or similar) for the `legacy-smelter` database on both projects.

Fallback path:

```bash
gcloud firestore databases describe \
  --database=legacy-smelter \
  --project=anchildress1-unstable \
  --format='value(locationId)'

gcloud firestore databases describe \
  --database=legacy-smelter \
  --project=anchildress1 \
  --format='value(locationId)'
```

Expected output: `us-east1` for both.

### 1.2 Secret Manager — GEMINI_API_KEY on both projects

```bash
gcloud secrets describe GEMINI_API_KEY --project=anchildress1-unstable
gcloud secrets describe GEMINI_API_KEY --project=anchildress1
```

If either returns `NOT_FOUND`, create the secret and seed it with the Gemini API key before proceeding:

```bash
gcloud secrets create GEMINI_API_KEY --project=<PROJECT> --replication-policy=automatic
printf '%s' '<API_KEY>' | gcloud secrets versions add GEMINI_API_KEY --data-file=- --project=<PROJECT>
```

Do NOT commit the key. The `firebase-functions/params` `defineSecret('GEMINI_API_KEY')` binding in `functions/index.js` reads from GSM at invocation time; the key is never materialized in deployable artifacts.

### 1.3 IAM — Cloud Functions v2 runtime service account

The Cloud Functions v2 runtime service account needs two role bindings on each project:

- `roles/secretmanager.secretAccessor` on `projects/<PROJECT>/secrets/GEMINI_API_KEY` — so the running function can actually read `geminiApiKey.value()` at invocation time.
- `roles/datastore.user` on the project — so it can read/write `incident_logs` via the admin SDK.

For a brand-new sanction deploy, you usually do not know the runtime SA email until after the first `firebase deploy --only functions`. Workflow:

1. Deploy the function (step 3 below).
2. If the first invocation logs `PERMISSION_DENIED` on secret access or Firestore, grab the SA email from `gcloud functions describe onIncidentCreated --project=<PROJECT> --region=us-east1 --gen2 --format='value(serviceConfig.serviceAccountEmail)'`.
3. Grant the two roles:

```bash
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --project=<PROJECT> \
  --member=serviceAccount:<SA_EMAIL> \
  --role=roles/secretmanager.secretAccessor

gcloud projects add-iam-policy-binding <PROJECT> \
  --member=serviceAccount:<SA_EMAIL> \
  --role=roles/datastore.user
```

4. Redeploy (or just wait for the next invocation) — IAM changes propagate in seconds.

### 1.4 Eventarc API enabled on both projects

The `onDocumentCreated` trigger creates an Eventarc subscription on deploy. If the API is disabled the deploy fails with a clear error, but the error shows up late in the pipeline. Verify early:

```bash
gcloud services list --enabled --project=anchildress1-unstable --filter='config.name:eventarc.googleapis.com'
gcloud services list --enabled --project=anchildress1 --filter='config.name:eventarc.googleapis.com'
```

If either is missing:

```bash
gcloud services enable eventarc.googleapis.com --project=<PROJECT>
```

### 1.5 Report to user

Before moving to step 2, post a short summary: Firestore regions, secret existence, Eventarc status. Flag anything missing or mismatched and stop for user decision. Do not proceed silently past a mismatch.

## 2. Unstable backfill

The backfill patches any pre-rebuild `incident_logs` docs that are missing `evaluated` or `sanction_lease_at`. Without it, those docs would never match the `claimBatch` where-filter (`evaluated == false` does not match a missing field) and would be permanently orphaned from the judging pipeline.

```bash
FIREBASE_PROJECT_ID=anchildress1-unstable \
FIREBASE_FIRESTORE_DATABASE_ID=legacy-smelter \
GOOGLE_APPLICATION_CREDENTIALS=/path/to/unstable-sa.json \
npx tsx scripts/backfill-evaluated.ts
```

The script is idempotent and safe to re-run. Expected output on a first run: a per-doc patch log line for every pre-rebuild doc, a `Committed batch of N` line per 400 patches, a final `Patched M documents out of N` summary, and a `Marked migration system_migrations/sanction-evaluated-v1 run <uuid> as complete` line.

Verify the migration marker:

```bash
# In Firebase console or via admin SDK:
# system_migrations/sanction-evaluated-v1 must exist
#   first_run_at: <this run's timestamp>
#   first_run_id: <uuid>
#   last_run_at: <this run's timestamp>
#   last_scanned_count: N
#   last_patched_count: M
# system_migrations/sanction-evaluated-v1/runs/<uuid> must exist
#   run_id, completed_at, scanned_count, patched_count, source
```

Spot-check: pick 5 random `incident_logs` docs that existed before the rebuild. Confirm each has `evaluated: false` and `sanction_lease_at: null`.

## 3. Unstable index + function deploy

**Order matters**: indexes deploy first and build asynchronously. The `claimBatch` query depends on the new `(evaluated ASC, timestamp ASC)` composite, so if you deploy the function before the index finishes building, the first invocation fails with a "missing index" error.

### 3.1 Deploy indexes

```bash
firebase deploy --only firestore:indexes --project anchildress1-unstable
```

Then poll the Firebase console → Firestore → Indexes page until `(evaluated ASC, timestamp ASC)` shows **Enabled** (not **Building**). For a small dataset this is usually a few seconds; on a large collection it can take minutes. Do not proceed until it is green.

### 3.2 Deploy functions

```bash
firebase deploy --only functions --project anchildress1-unstable
```

Watch the output for:
- `functions: creating Node.js 22 function onIncidentCreated(us-east1)...` on first deploy (or `updating` on subsequent).
- `functions: Secret GEMINI_API_KEY configured for onIncidentCreated.`
- `Deploy complete!`

If it fails on Eventarc permissions, the error will name the service account and the missing role — fix it per §1.3 and redeploy.

### 3.3 DO NOT deploy rules

The sanction rebuild does not modify `firestore.rules`. Running `firebase deploy --only firestore:rules` is unnecessary and also violates the "unstable first, prod requires explicit ask" guidance if it happens to pick up an unrelated in-flight rules change. Stay in `functions` + `firestore:indexes` targets only.

## 4. Unstable smoke test

Every step here is manual. If any step fails, stop and investigate before declaring the unstable deploy healthy.

### 4.1 Four uploads → no trigger action

Upload 4 test images via the unstable `/api/analyze` path. Expected:
- 4 new `incident_logs` docs, each with `evaluated: false`, `sanction_lease_at: null`, `sanctioned: false`.
- The `onIncidentCreated` function fires 4 times (once per create) but every invocation logs a no-op because there are fewer than `MIN_BATCH` unevaluated docs in the pool. Confirm in function logs:

```bash
gcloud functions logs read onIncidentCreated \
  --project=anchildress1-unstable \
  --region=us-east1 \
  --gen2 \
  --limit=20
```

Expected log shape per invocation: `[sanction-trigger] Incident created; running sanction batch.` then `[sanction-trigger] Sanction batch finished. { status: 'no-op' }`.

### 4.2 Fifth upload → full round-trip

Upload a 5th test image. The 5th trigger invocation should now have `MIN_BATCH` unevaluated docs. Confirm in logs:
- Sweep ran (likely recoveredCount: 0 since nothing is stale).
- Claim transaction flipped 5 docs.
- Gemini call returned a valid selection.
- Finalize committed a winner with `sanctioned=true, sanction_count=1, sanction_rationale=<text>, impact_score=<recomputed>`.
- All 5 leases cleared.

Verify in Firestore console:
- Exactly 1 doc in the batch has `sanctioned=true`.
- All 5 have `evaluated=true`.
- All 5 have `sanction_lease_at=null`.
- The winner's `sanction_rationale` is a non-empty string.
- The winner's `impact_score` equals `5·sanction_count + 3·escalation_count + 2·breach_count` for its counter values.

### 4.3 Second batch

Upload 5 more test images. Confirm a second independent batch processes and another winner is picked. Confirm the pool is once again empty of unevaluated docs.

### 4.4 Forced Gemini failure — recovery test

This is the critical test. It proves the sweep recovery path works end-to-end in the deployed environment.

1. Temporarily override the Gemini secret on the unstable function with an invalid key. Easiest path:

```bash
printf '%s' 'invalid-test-key' | gcloud secrets versions add GEMINI_API_KEY \
  --data-file=- --project=anchildress1-unstable
# (note the new version number)
```

   Cloud Functions v2 picks up the new secret version on the next cold start. You may need to force a new deploy or wait for instance recycling.

2. Upload 5 test images. The trigger will fire, sweep (no-op), claim 5 docs, call Gemini, fail, and throw. Confirm in logs:
   - `[sanction-trigger] Sanction batch failed; will retry.`
   - Cloud Functions v2 event retry kicks in, re-delivers the event, and the cycle repeats for the retry window.

3. Verify Firestore state mid-failure:
   - 5 docs with `evaluated=true` and an active `sanction_lease_at` (non-null).
   - No winner.
   - No losers got lease-cleared.

4. Restore the valid Gemini key:

```bash
gcloud secrets versions destroy <BAD_VERSION> \
  --secret=GEMINI_API_KEY --project=anchildress1-unstable
# Or roll forward by adding the valid key as a new version.
```

5. **Wait >5 minutes** (past `LEASE_TTL_MS`).

6. Upload 1 more image. This fires a new trigger. Confirm in logs:
   - Sweep finds 5 stale leases and clears them (`recoveredCount: 5`).
   - Claim flips 5 (now unevaluated again, plus the new one — so it claims the 5 oldest by timestamp).
   - Judge succeeds.
   - Finalize commits a winner.

7. Verify Firestore state: all 5 stranded docs are now either `sanctioned=true` (if one was the winner) or `evaluated=true, sanction_lease_at=null, sanctioned=false` (if a loser). No lingering leases.

This test is the end-to-end proof that the lease-based recovery pattern works in the real deployed environment, not just against the emulator.

## 5. User sign-off gate

**STOP.** Before any prod deploy, get explicit user sign-off on unstable behavior. Show them:
- Function logs for the happy-path batches (§4.2, §4.3).
- Function logs for the forced-failure recovery (§4.4).
- A Firestore sample showing a winner doc with correct fields.
- The `system_migrations/sanction-evaluated-v1` marker confirming the unstable backfill ran clean.

Do NOT proceed to §6 without user go-ahead. Per `feedback_firebase_deploy_unstable_only`, prod deploy requires explicit user ask.

## 6. Prod rollout

Only run after user sign-off from §5.

1. **Re-run §1 MCP verification against `anchildress1`**. Region, secret, IAM, Eventarc. Report back.
2. **Run `scripts/backfill-evaluated.ts` against prod** with prod credentials. Same marker audit check.
3. **Deploy indexes**:

```bash
firebase deploy --only firestore:indexes --project anchildress1
```

   Wait for the composite to finish building in the prod Firebase console.

4. **Deploy functions**:

```bash
firebase deploy --only functions --project anchildress1
```

5. **Light prod smoke test**: upload 5 real prod images through the normal user flow. Confirm one gets sanctioned, logs look clean, no errors.
6. **Do NOT run the forced-failure recovery test in prod.** That test destroys one batch and relies on lease expiry — it is only safe in the unstable environment where you control all incidents.

## 7. Post-deploy monitoring

Watch for 72 hours after prod deploy:

- **Function invocation count** — should roughly match incident creation rate. A wild spike indicates a retry storm (e.g. every invocation is throwing). A drop to zero indicates the trigger binding is broken.
- **Function error rate** — should be near zero. Transient Gemini blips throw and retry silently; sustained errors need investigation. Check for `[sanction-trigger] Sanction batch failed` log entries.
- **Firestore reads/writes** on the `legacy-smelter` database. The sanction path reads at most `(claim query + sweep query + 5 individual doc reads) ≈ 7 reads` per invocation and writes at most `5 claim updates + 5 finalize updates ≈ 10 writes` per successful invocation. A sustained usage jump well above that ratio means something is wrong.
- **Gemini API spend** on the project. The judging path uses `gemini-3.1-flash-lite-preview` at one call per 5 incidents (two calls max on retry). Watch for a sustained rate of 2 calls per invocation — that means half of invocations are hitting the retry branch and there is a prompt or schema regression.

## 8. Post-deploy cleanup

After prod is stable for at least 72 hours:

1. Delete `scripts/backfill-evaluated.ts`. The backfill is one-shot and the marker proves it ran.
2. Delete `docs/sanction-rebuild-prompt.md` — the build brief is no longer load-bearing; this checklist and the system-design doc replace it.
3. Verify these are already gone (they were deleted during the rebuild itself, not post-deploy): `scripts/sanction-incidents.ts`, `scripts/sanction-incidents.test.ts`, `scripts/sanction-incidents.run.test.ts`, `scripts/strip-judged-field.ts`, `docs/archive/judging-prompt.md` (if still present, delete).
4. Delete the runtime `system_locks/sanction-incidents` doc from both Firestore projects if it still exists — it was a polling-lock for the dying CLI script and has no remaining readers.
5. Commit the cleanup as a single PR. Do NOT bundle it with unrelated work.

## 9. Rollback plan

If the prod deploy shows regressions that cannot be fixed forward within the monitoring window:

1. **Revert the function**, not the schema. The new `evaluated` / `sanction_lease_at` fields on `incident_logs` are harmless to keep: rules do not touch them, client parser does not read them, and the fields cost bytes but break nothing.
2. Deploy a no-op function replacement (empty handler that logs and returns) to `anchildress1`:

```bash
# In functions/index.js, temporarily:
#   export const onIncidentCreated = onDocumentCreated({...}, async (event) => {
#     logger.info('[sanction-trigger] Rolled back; no-op.');
#   });
firebase deploy --only functions --project anchildress1
```

3. This stops all sanction judging without touching data. Unevaluated docs accumulate in the pool and can be re-judged after a fix-forward deploy.
4. **Do NOT delete the composite index** during rollback. It is still needed when the function is re-enabled, and index rebuilds are asynchronous and slow.
5. **Do NOT roll back the backfill**. The backfilled fields are harmless if the function is disabled.
6. File the incident, fix forward, re-run the full checklist from §0.

# AGENTS

## invariants

- `impact_score = 5*sanction_count + 3*escalation_count + 2*breach_count`. Stored on every `incident_logs` doc. Required by `orderBy('impact_score','desc')` in `src/App.tsx` and `src/components/IncidentManifest.tsx`, backed by composite index `(impact_score DESC, timestamp DESC)` in `firestore.indexes.json`. Firestore has no expression indexes — removing the field breaks both feeds. Do not remove without also changing the sort key in those two queries and deleting the index.
- Weights live in `shared/impactScore.js` (`IMPACT_WEIGHTS = { sanction: 5, escalation: 3, breach: 2 }`). Single source for TS/JS. `firestore.rules` duplicates the formula inside `impactScore(data)` because rules cannot import JS — manual sync required.
- Counter updates must be **paired** with `impact_score`. Rules require `affectedKeys().hasOnly(['<counter>', 'impact_score'])`. Writing a counter alone, or `impact_score` alone, is rejected with `permission-denied`.
- Rules enforce `request.resource.data.impact_score == impactScore(request.resource.data)` on every allowed update. Client cannot write a drifted value.
- `incident_logs` rule: `allow create: if false`. All creates go through `POST /api/analyze` which uses `firebase-admin` (bypasses rules). Do not move creates to the client — atomic write of the doc + `global_stats.total_pixels_melted` + derived `impact_score` depends on admin SDK.
- `/api/analyze` is protected by `requireFirebaseAuth` middleware verifying a Firebase ID token (anonymous is fine). Do not remove.
- `parseSmeltLog` in `src/lib/smeltLogSchema.ts` is strict. Every field required, no fallbacks. New fields must be added to schema + parser + server write simultaneously or docs will be rejected client-side.

## changing a weight

1. Edit `shared/impactScore.js` `IMPACT_WEIGHTS`.
2. Edit `firestore.rules` `impactScore()` function body.
3. Edit the literal `+ 2` / `+ 3` / `- 3` deltas in `isBreachIncrement`, `isEscalationIncrement`, `isEscalationDecrement`.
4. Run `scripts/backfill-voting-fields.ts` against every environment.
5. Deploy rules to both projects (see deploy).

## deploy

Two Firebase projects. No default in `firebase.json`. Always deploy rules to unstable only unless user explicitly says both:

```bash
firebase deploy --only firestore:rules --project anchildress1-unstable
firebase deploy --only firestore:rules --project anchildress1
```

Failure mode: committing a rules edit without deploying produces 403 `permission-denied` on valid client writes. Verify deploy with `firebase_get_security_rules` MCP tool.

## functions/sanction.js (Cloud Functions v2 trigger)

- Entry point: `functions/index.js` declares one `onDocumentCreated` trigger on `incident_logs/{incidentId}` against the named `legacy-smelter` Firestore database. The orchestrator (`runSanctionBatch`) lives in `functions/sanction.js` so unit tests can import it without the `firebase-functions` runtime.
- Candidate discovery uses `where('evaluated', '==', false).orderBy('timestamp', 'asc').limit(5)`. New fields on `incident_logs`: `evaluated: boolean` (claim flag) and `sanction_lease_at: Timestamp | null` (claim lease). `persistIncident` in `server.js` writes both with safe defaults; pre-rebuild docs are patched by `scripts/backfill-evaluated.ts`.
- Claim is transactional and all-or-nothing. `claimBatch` reads the oldest 5 unevaluated docs inside a Firestore transaction and, in the same transaction, marks every one `evaluated=true` + `sanction_lease_at=<now>`. Two concurrent invocations cannot claim overlapping sets because Firestore aborts the losing transaction on write contention. Fewer than 5 unevaluated docs → the invocation returns `{ status: 'no-op' }` without touching anything.
- Losers are out permanently after one batch. Each batch picks exactly one of 5 to sanction; the winning doc gets `sanctioned=true`, `sanction_count=1`, `sanction_rationale`, recomputed `impact_score`, and `sanction_lease_at=null`. The four losing docs only get `sanction_lease_at=null` — they keep `evaluated=true` and never re-enter the pool. "One chance only" is the explicit semantics.
- Finalize is atomic. All five lease-clears + the winner write happen in one `WriteBatch.commit()`. Never write `impact_score` alone or a counter alone — Firestore rules reject unpaired counter writes.
- Sweep-based recovery. If a run throws between claim and finalize, the 5 claimed docs are stuck with `evaluated=true` + an active lease. Cloud Functions v2 event retry re-delivers the triggering event; on the next invocation, `sweepStaleLeases` clears any lease older than `LEASE_TTL_MS` (5 minutes) and the docs re-enter the pool. The sweep is idempotent; parallel sweeps are safe.
- On model failure (no valid selection after `MAX_SELECTION_ATTEMPTS=2`): throws. Claim stays in place; recovery is via sweep + retry. There is no partial-write state.
- Malformed docs crash loudly. Without a "skip me" marker they cannot be safely excluded, so `parseIncidentDoc` and `requireNonNegativeCounter` throw with the incident ID in the error message — the operator fixes the offending doc by hand and the retry picks up cleanly.
- Uses `gemini-3-flash-preview` — intentionally stronger than `/api/analyze` which uses `gemini-3.1-flash-lite-preview`. The lite model defaults to academic rubric-speak when judging humor; full flash has the depth to read a batch and write rationales that sound like a person. Note: `gemini-2.5-*` is the previous generation and should not be used. `GEMINI_API_KEY` is bound via `firebase-functions/params` `defineSecret` from Google Secret Manager.

## scripts/backfill-voting-fields.ts / scripts/backfill-evaluated.ts

- Both scripts are idempotent. `backfill-voting-fields.ts` patches `breach_count` / `escalation_count` / `sanction_count` / `sanctioned` / `sanction_rationale` / `impact_score`. `backfill-evaluated.ts` patches `evaluated` / `sanction_lease_at` for pre-rebuild docs so they become eligible for the judging pipeline.
- Each appends to a migration marker under `system_migrations/<marker>/runs` on every run and never overwrites `first_run_at`. Audit trail is preserved across re-runs.

## code style

- Prefer top-level `await` over `.then()`/`.catch()` promise chains in all new code. Applies to scripts, Cloud Functions entry points, and any module-level async work. Existing promise chains should be converted when touched.

## memory

User-level memory at `~/.claude/projects/-Users-anchildress1-git-personal-legacy-smelter/memory/` persists across sessions. Referenced in `MEMORY.md` index:
- `project_post_merge_db_cleanup.md` — cleanup old-format docs from shared Firestore after merge.
- `feedback_no_quick_fixes.md` — no temporary workarounds, always full long-term solutions.

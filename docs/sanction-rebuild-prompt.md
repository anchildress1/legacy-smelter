# Sanction System Rebuild — Build Brief

**Audience**: Claude CLI agent taking this to implementation.
**Source of truth**: `AGENTS.md` (read first), `server.js`, `scripts/sanction-incidents.ts` (dying), `firestore.rules`, `firestore.indexes.json`, `shared/impactScore.js`.
**Do not** guess. If anything below is ambiguous after reading the referenced files, stop and ask the user before writing code.

---

## 0. TL;DR

Move the sanction flow from the standalone CLI script into a **Firebase Cloud Functions v2 Firestore trigger** (`onDocumentCreated` on `incident_logs/{id}`). Every 5 new incidents trigger a judging batch. Gemini picks one winner. All 5 are permanently removed from the pool. On Gemini failure, stuck leases are recovered on the next invocation's sweep.

Delete the old script and related dead code. **Do not touch the `impact_score` storage model or `sanction_count` field** — both are deferred tech debt logged in `MEMORY.md`.

---

## 1. Current state (what exists today)

- `server.js` — single-file Express app. `POST /api/analyze` takes a base64 image, calls Gemini Flash-Lite for classification, writes an `incident_logs` doc via firebase-admin, bumps `global_stats/main.total_pixels_melted`, returns the doc id. Rate-limited, auth-guarded with Firebase ID tokens.
- `scripts/sanction-incidents.ts` — CLI script that does sanction judging. Polls for 5 oldest `sanctioned==false`, calls Gemini with a judging prompt loaded from `docs/judging-prompt.md`, picks one to mark `sanctioned=true`. Uses a global run-lock at `system_locks/sanction-incidents`. **Dying in this change.**
- `shared/impactScore.js` — `IMPACT_WEIGHTS = { sanction: 5, escalation: 3, breach: 2 }`, `computeImpactScore()`. Unchanged in this work.
- `firestore.rules` — enforces `impact_score == impactScore(data)` on client updates, with an inline duplicate of the formula. Unchanged except for optional formatting; do NOT modify the formula.
- `firestore.indexes.json` — composite `(sanctioned ASC, timestamp ASC)` exists; `(impact_score DESC, timestamp DESC)` exists.
- `src/lib/smeltLogSchema.ts` — strict `parseSmeltLog`; adding a new client-visible field requires schema + parser + server write updated simultaneously or docs get rejected client-side. **This change does not require parser updates** (see §5).

---

## 2. Target behavior

1. User uploads an image → `POST /api/analyze` → Gemini analyzes → doc written to `incident_logs` → response returned to user. **No change to the HTTP path beyond initializing two new fields in `persistIncident`.**
2. Firestore `onDocumentCreated('incident_logs/{id}')` trigger fires asynchronously.
3. Trigger handler:
   a. **Sweep**: recover any stuck leases from prior failed runs (TTL = 5 min).
   b. **Claim** (transaction): read oldest 5 `evaluated==false`, atomically mark all 5 `evaluated=true, sanction_lease_at=now`.
   c. **Judge**: call Gemini with a server-side judging prompt (inlined constant, NOT read from a file), up to 2 retry attempts.
   d. **Finalize** (transaction): winner gets `sanctioned=true, sanction_count=1, sanction_rationale=<text>, impact_score=<recomputed>`; all 5 get `sanction_lease_at=null`.
4. If fewer than 5 unevaluated incidents exist, trigger exits clean. Wait for more uploads.
5. On Gemini total failure: function throws. Cloud Functions v2 retries the event. Stale leases recovered by next sweep.

---

## 3. Decisions locked in (do not re-open, do not expand scope)

| # | Decision |
|---|---|
| 1 | Trigger = Cloud Functions v2 Firestore `onDocumentCreated`. Not inline, not Cloud Tasks. |
| 2 | Losers are permanently out after one batch. One chance only. |
| 3 | Best-effort recovery on Gemini failure via `sanction_lease_at` + sweep + Cloud Functions retry. Do NOT burn the 5 on failure. |
| 4 | Claim strategy: transaction sets `evaluated=true` + `sanction_lease_at=now` on all 5 atomically BEFORE calling Gemini. No separate `sanction_batch_id` — `sanction_lease_at` does the pending-vs-final job alone. |
| 5 | Lease TTL = 5 minutes. |
| 6 | Gemini model = `gemini-3.1-flash-lite-preview` (same as analyze path). |
| 7 | Judging prompt is **inlined as a `JUDGING_PROMPT` constant** in the function code, written fresh from the criteria in `docs/judging-prompt.md`. Do NOT `readFileSync` the doc. The doc is guidance; write real code from it, then delete the doc. |
| 8 | `GEMINI_API_KEY` stored in Google Secret Manager, wired into the function via `defineSecret('GEMINI_API_KEY')`. Reuse the same secret the server already uses. |
| 9 | **`impact_score` stays stored on the doc.** No change to `shared/impactScore.js`, no change to `firestore.rules` `impactScore()`, no change to `firestore.indexes.json` impact_score composite. Sanction finalize writes a correctly-paired `impact_score` via the existing `computeImpactScore()` function. This is deferred tech debt — future-me problem. |
| 10 | **`sanction_count` stays as a field.** Sanction finalize writes `sanction_count: 1` on the winner, paired with `impact_score` recomputation, per current invariants. Also deferred tech debt. See §11 for the explanation of what it is so future-me knows when they come back. |
| 11 | Sanction failure MUST NOT fail the `/api/analyze` response. Trigger runs independently; failures log + throw inside the function to activate Cloud Functions retries. |
| 12 | Rate limiting on `/api/analyze` is unchanged. The sanction trigger has no rate limit — it's bounded by incident creation rate. |
| 13 | Client UI reads sanction status from existing `sanctioned` boolean. **No `parseSmeltLog` change required** for the new `evaluated` / `sanction_lease_at` fields — they are server-only. |
| 14 | Deploy order: unstable first (`anchildress1-unstable`), then prod (`anchildress1`), gated on manual smoke test between environments. |

---

## 4. MCP verification required before deploy

Before any deploy, the build agent must:

1. **Check Firestore region for both projects**: `anchildress1-unstable` and `anchildress1`. Expected: `us-east1` for both. Try in order:
   - Firebase MCP tools — look for a database-metadata tool in the same MCP server that exposes `firebase_get_security_rules` (referenced in AGENTS.md).
   - Fallback: `gcloud firestore databases describe --database=$VITE_FIREBASE_FIRESTORE_DATABASE_ID --project=<project>`.
   - Report both regions back to user. Abort if mismatch between Firestore region and Function deploy region.
2. **Check Secret Manager** for `GEMINI_API_KEY` on both projects. Create if missing.
3. **Grant the Cloud Functions v2 runtime service account** `roles/secretmanager.secretAccessor` on the secret, `roles/datastore.user` on the project.
4. **Confirm Eventarc API** is enabled on both projects.
5. **After any rules deploy**, call `firebase_get_security_rules` MCP tool to verify deployed version matches the committed file (per AGENTS.md deploy guidance).

---

## 5. Data schema changes

### New fields on `incident_logs`

| Field | Type | Default on create | Written by |
|---|---|---|---|
| `evaluated` | boolean | `false` | `persistIncident` in `server.js`; flipped to `true` by sanction trigger claim |
| `sanction_lease_at` | Timestamp \| null | `null` | set by claim, cleared by finalize, cleared by sweep recovery |

### Unchanged

All existing fields — including `sanctioned`, `sanction_rationale`, `sanction_count`, `impact_score`, `breach_count`, `escalation_count`, and every content field — stay as-is. `persistIncident` continues to write `sanction_count: 0` and `impact_score: 0` on creation like it does today.

### Rules contract

- Client never writes `evaluated` or `sanction_lease_at`. No `firestore.rules` change needed.
- Admin SDK writes (both initial create and sanction finalize) bypass rules.
- Existing `hasOnly()` guards on counter increments keep working — they never mentioned the new fields.

### Index changes

Add ONE composite to `firestore.indexes.json`:

```json
{
  "collectionGroup": "incident_logs",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "evaluated", "order": "ASCENDING" },
    { "fieldPath": "timestamp", "order": "ASCENDING" }
  ]
}
```

`sanction_lease_at` single-field index is auto-created by Firestore for the sweep query (`where('sanction_lease_at', '<', cutoff)`).

**Do not remove any existing index.**

### Client schema

`parseSmeltLog` in `src/lib/smeltLogSchema.ts` is unchanged. New fields are server-only.

---

## 6. File inventory

### New files

- `functions/index.js` — Cloud Functions v2 entry. Exports `onIncidentCreated` trigger. `defineSecret('GEMINI_API_KEY')`. Retries enabled. Region pinned to Firestore region verified in §4.
- `functions/sanction.js` — pure logic module. Exports `sweepStaleLeases`, `claimBatch`, `judgeBatch`, `finalizeWinner`, `runSanctionBatch`. Imports `computeImpactScore` from `shared/impactScore.js`. Inlines `JUDGING_PROMPT` constant.
- `functions/package.json` — minimal. Pins `firebase-functions`, `firebase-admin`, `@google/genai`.
- `functions/.eslintrc` or equivalent — match repo lint style.
- `scripts/backfill-evaluated.ts` — one-shot. Sets `evaluated=<current sanctioned value>`, `sanction_lease_at=null` on every `incident_logs` doc. Idempotent. Appends to `system_migrations/evaluated-fields-v1/runs` subcollection following the existing backfill pattern in `scripts/backfill-voting-fields.ts`.

### Modified files

- `server.js` — `persistIncident()` adds `evaluated: false, sanction_lease_at: null` to the initial write. **Nothing else changes in server.js.** No sanction code in the HTTP server.
- `firestore.indexes.json` — add composite per §5.
- `firebase.json` — add `functions` block.
- `firebase.test.json` — same.
- `AGENTS.md` — rewrite the "scripts/sanction-incidents.ts" section to describe the Functions trigger, `evaluated` / `sanction_lease_at` invariants, sweep recovery, lease TTL. Remove the "losers re-enter" line. Remove the global run-lock reference. **Do not touch the `impact_score` or weights sections.**
- `MEMORY.md` — add entries per §11.

### Deleted files

- `scripts/sanction-incidents.ts`
- `scripts/sanction-incidents.test.ts`
- `scripts/sanction-incidents.run.test.ts`
- `scripts/strip-judged-field.ts` (already-dead migration tool)
- `docs/judging-prompt.md` (after prompt is inlined in `functions/sanction.js`)
- `scripts/backfill-evaluated.ts` (after it runs successfully in both environments)
- Runtime doc: `system_locks/sanction-incidents` (delete via admin SDK one-liner or Firebase console on both projects)

### Grep-and-fix pass

Before commit, grep for and remove lingering references to:

- `sanction-incidents` (script path references in CI, Makefile, package.json scripts, etc.)
- `system_locks/sanction-incidents`
- `judged` / `judging` (outside the deleted `strip-judged-field.ts` and `judging-prompt.md`)
- `runSanctionIncidents` (old export)
- `MAX_SELECTION_ATTEMPTS` (old constant from dead script)

---

## 7. Invariants to preserve

1. **Sanction update pairs**: winner's finalize write must set `sanctioned, sanction_count, sanction_rationale, sanction_lease_at=null, impact_score` atomically in ONE batch/transaction. Never write `impact_score` alone or a counter alone — Firestore rules reject it even from admin writes (the rules check applies per update, not per auth).
2. **Admin SDK only**: every sanction-related write goes through firebase-admin. Client never touches these paths.
3. **Single source of prompt truth**: `JUDGING_PROMPT` lives inline in `functions/sanction.js`. No runtime file reads.
4. **Lease TTL is authoritative**: any doc with `sanction_lease_at` older than 5 minutes is considered stuck and reclaimable by sweep. Function invocations always sweep before claiming.
5. **Claim-before-judge**: Gemini is never called on docs that haven't first been marked `evaluated=true` inside a transaction. Two concurrent function invocations MUST NOT judge overlapping sets — prove this under the transaction claim model in the system-design output (§8).
6. **Failure isolation**: sanction trigger throw → Cloud Functions retries → sweep recovers stale leases. `/api/analyze` success path is never coupled to sanction outcome.
7. **Impact score pairing stays enforced**: rules invariant `impact_score == impactScore(data)` is unchanged. Sanction finalize writes a correct recomputed value via existing `computeImpactScore()`.
8. **`sanction_count` stays paired with `sanctioned`**: finalize writes both together. Do not treat sanction_count as optional or derived — the rules formula still multiplies it.

---

## 8. System design — invoke `/engineering:system-design`

Use the system-design skill to produce an architecture document covering:

- Component diagram: HTTP server, Firestore, Eventarc, Cloud Function, Gemini, Secret Manager.
- Sequence diagram for the happy path: upload → doc create → trigger fires → sweep → claim transaction → judge → finalize transaction.
- Sequence diagram for the failure path: Gemini throws → function throws → Cloud Functions retries → next invocation sweeps → previously-stuck docs re-enter pool.
- Concurrency analysis: what happens with N concurrent incident creates when N > 5. Prove no overlap is possible under the transaction claim. Include the case of 3 concurrent function invocations claiming from 15 unevaluated docs.
- Data model section: new fields, unchanged fields, rules contract, index set.
- Trade-off section: why Firestore trigger over Cloud Tasks, why lease over burn, why inline prompt over file import, why KEEP `impact_score` stored and `sanction_count` as a field (defer to §11).

Output: `docs/sanction-system-design.md` (permanent, not deleted).

---

## 9. Test strategy — invoke `/engineering:testing-strategy`

Use the testing-strategy skill to produce a test plan covering:

### Unit tests (`functions/sanction.test.js`, emulator-free, mock firebase-admin)

- `sweepStaleLeases`: stale lease → cleared (`evaluated=false, sanction_lease_at=null`); fresh lease → untouched; no leases → no-op.
- `claimBatch`: exactly 5 unevaluated → claims all 5, sets both fields atomically; 4 → returns empty, no writes; 6+ → claims oldest 5 by timestamp, leaves the rest.
- `judgeBatch` / prompt normalization (port from deleted `sanction-incidents.test.ts`):
  - Valid Gemini response → `{ sanctioned_incident_id, sanction_rationale }`.
  - Missing `sanctioned_incident_id` → throws.
  - Non-candidate id → throws.
  - Empty / whitespace rationale → throws.
  - 2 retries on transient failure → succeeds on retry.
  - All retries fail → throws.
- `finalizeWinner`: writes correct `impact_score` recomputation, sets `sanctioned=true, sanction_count=1, sanction_rationale=<text>`, clears `sanction_lease_at` on all 5, only winner gets sanction fields, losers only get lease cleared.
- Port `sanitizeRationale`, `normalizeSelection`, `parseIncidentDoc`, `requireNonNegativeCounter` test cases from the old test files.

### Integration tests (Firestore emulator, `functions/sanction.emulator.integration.test.js`)

- Seed 5 unevaluated docs → run `runSanctionBatch` → assert exactly 1 `sanctioned=true`, all 5 `evaluated=true`, all 5 `sanction_lease_at=null`, impact_score recomputed correctly on winner, winner's `sanction_count=1`.
- Seed 4 unevaluated docs → run → assert nothing written.
- Seed 10 unevaluated docs → run twice → assert 2 winners, 10 evaluated, no overlap.
- **Concurrent claim test**: fire `runSanctionBatch` 3x in parallel against 15 docs → assert exactly 3 winners, exactly 15 evaluated, no doc claimed twice, no transaction deadlock.
- **Stale lease recovery**: seed 5 docs with `sanction_lease_at` set to 10 minutes ago + `evaluated=true` → run → assert sweep clears both fields, claim re-acquires, normal finalize.
- **Gemini failure path**: mock Gemini client to throw on every attempt → run → assert function throws, docs stay `evaluated=true, sanction_lease_at=<now>`, no winner; advance clock past TTL → run again → assert sweep recovers, claim + judge completes successfully on the replay.
- **Retry-on-invalid-selection**: first Gemini response returns invalid id, second returns valid id → assert finalize writes winner from second response.

### Contract tests

- Rules emulator test: client attempting to write `evaluated` or `sanction_lease_at` is rejected by default-deny update rule (since new fields aren't in any `hasOnly()` allowlist).
- Existing rules tests re-run green — no rules changes in this work.

### Regression

- Re-run existing `scripts/server.analyze.integration.test.ts` — assert new `evaluated: false, sanction_lease_at: null` fields present on every new doc.
- Re-run `scripts/firestore.rules.integration.test.ts` — assert rules still reject client sanction writes.

### Deleted tests

- `scripts/sanction-incidents.test.ts`
- `scripts/sanction-incidents.run.test.ts`

Output: `docs/sanction-test-plan.md`.

---

## 10. Deploy plan — invoke `/engineering:deploy-checklist`

Use the deploy-checklist skill to produce a pre-deploy verification list. At minimum:

### Pre-deploy (on unstable)

1. Run MCP verification per §4: Firestore region, Secret Manager, IAM, Eventarc. Report results to user.
2. Run `scripts/backfill-evaluated.ts` against **unstable** first. Verify `system_migrations/evaluated-fields-v1` marker created. Spot-check 5 random docs for correct `evaluated` / `sanction_lease_at` values.
3. Deploy indexes: `firebase deploy --only firestore:indexes --project anchildress1-unstable`. Wait for `(evaluated ASC, timestamp ASC)` build to complete (check Firebase console — async, can take minutes).
4. Deploy functions: `firebase deploy --only functions --project anchildress1-unstable`.
5. **Do not deploy rules** — this change does not modify `firestore.rules`.

### Smoke test (unstable)

1. Upload 4 test images via `/api/analyze`. Confirm 4 docs with `evaluated=false, sanction_lease_at=null`, no sanction trigger firing.
2. Upload a 5th. Watch function logs. Confirm: sweep ran (no-op), claim transaction set 5 `evaluated=true` + lease timestamps, Gemini call returned, finalize set 1 winner with `sanctioned=true, sanction_count=1, sanction_rationale` populated, recomputed `impact_score`, and cleared all 5 leases.
3. Verify in Firestore console: exactly 1 winner, 5 evaluated, 0 leases outstanding.
4. Upload 5 more. Confirm a second independent batch processes.
5. **Force Gemini failure test**: temporarily set an invalid API key override in the function config → upload 5 → confirm function throws, docs stay `evaluated=true` with `sanction_lease_at` set, no winner → restore valid key → wait >5 minutes → upload 1 more → confirm sweep recovers the stuck batch and processes it.

### Prod deploy (gated on user sign-off after unstable smoke test)

1. Run MCP verification again against `anchildress1`.
2. Run backfill against prod.
3. Deploy indexes, then functions.
4. Light smoke test: upload 5 prod images, confirm one sanctioned.
5. Monitor function logs for 24h. Watch Firestore reads/writes dashboard. Watch Gemini spend.

### Post-deploy cleanup (after prod is stable)

1. Delete `scripts/backfill-evaluated.ts`.
2. Delete `docs/judging-prompt.md`.
3. Delete old sanction script + tests (`scripts/sanction-incidents.ts`, `scripts/sanction-incidents.test.ts`, `scripts/sanction-incidents.run.test.ts`).
4. Delete `scripts/strip-judged-field.ts`.
5. Delete `system_locks/sanction-incidents` runtime doc from both Firestore instances.
6. Commit cleanup.
7. Update `AGENTS.md` and `MEMORY.md`.

Output: `docs/sanction-deploy-checklist.md`.

---

## 11. Deferred tech debt — log in `MEMORY.md`

Add two entries so future-me knows these are conscious deferrals, not oversights:

### 11.1 `impact_score` stored field

**What it is**: `impact_score` is persisted on every `incident_logs` doc and indexed by a composite `(impact_score DESC, timestamp DESC)`. It's used by `orderBy('impact_score','desc')` in `src/App.tsx` and `src/components/IncidentManifest.tsx` for the server-side feed sort.

**Why it's a stored field instead of a client-side compute**: Firestore has no expression/computed indexes. To sort by a derived value server-side, the value must physically exist on the doc so Firestore can index it. AGENTS.md §1 documents this.

**Why it's deferred**: Moving compute to the client means changing feed queries to `orderBy('timestamp','desc')` + client-side sort on a bounded window. That works for small N, scales poorly. The full refactor touches `src/App.tsx`, `src/components/IncidentManifest.tsx`, rules, index, and backfill. Not in scope for the sanction rebuild.

**Cleanup path when ready**: decide on feed bounded-window size → update feed queries → remove `impact_score` from `persistIncident` and sanction finalize → remove composite index → remove rules invariant → remove `computeImpactScore` usage at write sites → backfill to drop the field.

### 11.2 `sanction_count` as a stored "counter"

**What it is**: A numeric field on `incident_logs` that's always 0 or 1. Set to 0 on doc creation in `persistIncident`, flipped to 1 by the sanction finalize write. Used by the impact formula `5*sanction_count + 3*escalation_count + 2*breach_count` in both `shared/impactScore.js` and the inline duplicate in `firestore.rules` `impactScore()`.

**Why it exists**: Formula symmetry. `breach_count` and `escalation_count` are true counters (multiple users can breach/escalate the same incident), so the original author wrote all three contributors in the same `weight × count` shape. `sanction_count` was made to fit that shape even though it's structurally a boolean — once a doc is sanctioned it's out of the pool forever, so there's no second increment possible.

**What it's equivalent to**: `sanctioned ? 1 : 0`. The `sanctioned` boolean already carries exactly the same information.

**Why it's deferred**: Killing the field is cosmetic. Blast radius is real: `shared/impactScore.js` formula, `firestore.rules` inline formula, `src/types.ts`, `parseSmeltLog` if it reads the field, backfill to drop it from every existing doc, AGENTS.md invariants. Not worth doing alongside the sanction rebuild — keep the scope tight.

**Cleanup path when ready**: change formulas to `(sanctioned ? 5 : 0) + 3*escalation_count + 2*breach_count` in both JS and rules → update rules + re-verify with MCP → update `src/types.ts` and parser if applicable → backfill to `FieldValue.delete()` the field → update AGENTS.md weights section.

### 11.3 `sanctioned` boolean redundancy (optional nice-to-have)

`sanctioned` boolean is also redundant with `sanction_rationale != null`. If 11.2 happens, collapse this at the same time. Low priority.

---

## 12. Out of scope (do not touch)

- `POST /api/analyze` classification prompt, Gemini response schema, image validation, rate limiting, auth middleware, OG share route.
- `escalations` subcollection rules and client flow.
- `global_stats/main` counter.
- `shared/impactScore.js` — formula, weights, exports.
- `firestore.rules` — formula duplicate, counter guards, anything.
- `firestore.indexes.json` impact_score composite (keep as-is).
- `src/types.ts`, `src/lib/smeltLogSchema.ts` — no changes needed.
- Client feed components (`src/App.tsx`, `src/components/IncidentManifest.tsx`).
- The analysis path's Gemini model or response handling.

---

## 13. Definition of done

- [ ] MCP region + secret + IAM verification done and reported to user (§4).
- [ ] All files in §6 new/modified/deleted inventory handled.
- [ ] `functions/sanction.js` contains inlined `JUDGING_PROMPT` written fresh from `docs/judging-prompt.md` criteria — NOT copy-pasted.
- [ ] Unit + integration + rules tests green locally (Firestore emulator).
- [ ] Backfill run successfully in unstable; `system_migrations/evaluated-fields-v1` marker created.
- [ ] Indexes + functions deployed to unstable.
- [ ] Unstable smoke test passed including the forced-Gemini-failure recovery test.
- [ ] User signed off on unstable behavior.
- [ ] Same sequence repeated in prod.
- [ ] Dead files deleted; final cleanup commit pushed.
- [ ] `AGENTS.md` updated (sanction section only — do NOT touch impact_score or weights sections).
- [ ] `MEMORY.md` updated with the three deferred tech debt entries from §11.
- [ ] `docs/sanction-system-design.md`, `docs/sanction-test-plan.md`, `docs/sanction-deploy-checklist.md` committed.
- [ ] Cost monitoring note added: watch Firestore reads/writes dashboard for first 72h, watch function invocation count, watch Gemini spend.

---

## 14. Notes for the build agent

- **Argue, don't guess.** User is a collaborator and pushes back hard on unclear ideas. If you hit ambiguity, stop and ask before assuming.
- **User is ADHD-friendly direct.** A question like "wtf is X for?" is a real question, not venting. Answer it directly, then let them decide. Do not assume rhetorical framing.
- **Do not expand scope.** `impact_score` stays stored. `sanction_count` stays. The single-file server stays single-file. Sanction lives entirely under `functions/`.
- **The old script is instructive — read it before deleting.** It has working patterns for Gemini selection parsing (`normalizeSelection`), rationale sanitization (`sanitizeRationale`), counter validation (`requireNonNegativeCounter`), and retry-on-invalid-response. Port those into `functions/sanction.js` verbatim where applicable — do not reinvent.
- **Do not `readFileSync` the judging prompt.** Write a fresh `JUDGING_PROMPT` string constant based on the criteria in `docs/judging-prompt.md`, in the same inlined style as `GEMINI_PROMPT` in `server.js`.
- **Do not leave TODOs.** If something can't be done, raise it with the user.
- **Rules deploys are two-project per AGENTS.md** — but this change does NOT deploy rules. Do not run `firebase deploy --only firestore:rules` at all.
- **Index builds are asynchronous.** After `firebase deploy --only firestore:indexes`, check Firebase console and wait for "Enabled" status before deploying functions that depend on the index.
- **Concurrency claim**: the transaction that reads oldest 5 and writes `evaluated=true` must be the ONLY path that mutates these two fields in the claim direction. If you find yourself adding a second writer, stop and rethink.

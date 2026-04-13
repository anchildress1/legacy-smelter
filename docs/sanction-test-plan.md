# Sanction judging — test plan

**Status:** Permanent. Pair with `docs/sanction-system-design.md`. Every test referenced here must stay green on `main`; CI runs the unit suite on every push and the emulator suite on the `test:api:emulator` job.

This document describes the complete test coverage for the sanction judging pipeline: what each layer proves, why it exists as a separate layer, and what regressions it catches. If you are adding a test, find the layer it belongs in below and match the existing style.

## 1. Test layers at a glance

| Layer | File | Runs against | What it proves |
|---|---|---|---|
| Unit | `functions/sanction.test.js` | Mocked `firebase-admin` + mocked `@google/genai` | Pure logic, helper branches, orchestration shape |
| Integration | `functions/sanction.integration.test.js` | Firestore emulator + mocked Gemini | Real transactional semantics, real query indexes, real batch atomicity |
| Rules/contract | `scripts/firestore.rules.integration.test.ts` | Rules emulator | Client cannot write sanction fields |
| Regression (API) | `scripts/server.analyze.integration.test.ts` + `scripts/server.analyze.emulator.integration.test.ts` | Mocked admin / real emulator | `persistIncident` initializes `evaluated` and `sanction_lease_at` |

The unit and integration suites are intentionally redundant on the happy path. Duplication is the point: if one layer regresses the other still catches it. See §5 for the "what does each layer catch that the other cannot" breakdown.

## 2. Unit tests — `functions/sanction.test.js`

Emulator-free, ~200ms total runtime, runs on every push via `npm run test`. Mocks `firebase-admin/app`, `firebase-admin/firestore`, and `@google/genai` via `vi.hoisted` so the module under test can import `getFirestore` and `GoogleGenAI` naturally while we control their behavior.

### 2.1 Fixture strategy

- `makeMockDb({ claimQuerySize, claimQueryDocs, sweepDocs })` builds the exact Firestore surface `sanction.js` touches: `collection().where().orderBy().limit().get()`, `runTransaction`, and `batch()`. Returns references to every inner mock so tests assert call counts, payload shapes, and ordering — not just return values.
- `StubTimestamp` is a two-method stub (`fromMillis`, `toMillis`). `sanction.js` only calls those two; the rest of the real `Timestamp` API is dead weight for unit tests.
- `__resetSanctionSingletonsForTests` is an explicit test seam exported from `sanction.js` that clears the lazy `_db` / `_ai` caches between tests. Every phase test calls it in `beforeEach`.

### 2.2 Pure helpers

Full branch coverage on every error path. These helpers have no Firestore dependency so they are the cheapest place to prove the validation contract.

| Describe block | Proves |
|---|---|
| `sanitizeRationale` | Trims whitespace, caps at 500 chars, coerces non-strings to `''`. |
| `parseIncidentDoc` | Happy-path shape extraction; throws with the incident id embedded when any required string is missing; throws on null/string/number payloads (non-object guard). |
| `requireNonNegativeCounter` | Returns finite non-negative numbers; throws `non-finite` on missing/NaN/Infinity/string; throws `negative` on negative numbers. |
| `normalizeSelection` | Accepts the `rationale` alias for `sanction_rationale`; rejects missing id, unknown candidate, whitespace-only rationale, and non-string id. |

Every branch in these four helpers is covered because when a malformed doc lands in the judging pool the function should crash loudly with the incident id in the error message — the operator fixes it by hand and the retry picks up cleanly (per AGENTS.md §functions/sanction.js). If these helpers silently coerce bad data the crash-loud guarantee breaks.

### 2.3 Sanction phases

Each phase has its own describe block and its own mock-db instance.

**`sweepStaleLeases`**
- Empty sweep → `recoveredCount: 0`, no batch commit instantiated (proves the early-exit branch does not issue a zero-update commit — a silent cost leak).
- Non-empty sweep → one batch commit, one update per stale doc, every update payload is exactly `{ evaluated: false, sanction_lease_at: null }`.

**`claimBatch`**
- Below `MIN_BATCH` (4 docs) → returns `[]`, `tx.update` is never called. Proves the all-or-nothing guarantee: a short pool never gets partially flipped.
- Exactly `MIN_BATCH` (5 docs) → returns 5 claim entries, each with `evaluated: true` and `sanction_lease_at.toMillis() === now`. Asserts ref identity (`claimed[i].ref === docs[i].ref`) so `finalizeWinner` writes to the right document. Asserts pre-claim data is surfaced in `claimed[i].data` so the recompute path reads the correct counter values.

**`judgeBatch`**
- Valid response on first call → returns normalized selection, `generateContent` called exactly once.
- Empty text on first call, valid on second → retries and succeeds, `generateContent` called twice.
- Invalid response (unknown candidate) on both attempts → throws `Gemini failed to produce a valid selection after ${MAX_SELECTION_ATTEMPTS}`.
- `generateContent` rejects on both attempts → surfaces the final error message, proves the retry loop actually runs on thrown exceptions (not just invalid-shape responses).

**`finalizeWinner`**
- Happy path (5 docs, selection picks doc 2) → one batch commit, 5 updates. Winner payload: `{ sanctioned: true, sanction_count: 1, sanction_rationale: 'reason', impact_score: 17, sanction_lease_at: null }` (17 = 5·1 + 3·2 + 2·3). Loser payload: `{ sanction_lease_at: null }` — nothing else. Proves the rules-pairing invariant: `impact_score` is only written alongside `sanction_count`, never alone.
- Selection references a doc not in the batch → throws `Selected incident inc-99 is not in the batch`. This defends against a Gemini response that references a stale candidate id from a prior invocation.
- Winner has a corrupt counter (`breach_count: NaN`) → throws `non-finite "breach_count"` *before* any write happens. Proves we do not commit a partially-valid finalize batch.

**`runSanctionBatch`**
- No-op path (short pool) → returns `{ status: 'no-op' }`, `generateContent` never called. Proves the short-circuit happens before any Gemini spend.
- Full round-trip → returns `{ status: 'completed', winnerId, impactScore }`, exactly one batch commit (sweep was empty, claim was transactional, only finalize commits).
- Judge fails after all retries → orchestrator rethrows, so Cloud Functions v2 event retry fires. Proves the error propagation chain is not swallowed anywhere between `judgeBatch` and the trigger entry point.

## 3. Integration tests — `functions/sanction.integration.test.js`

Emulator-backed, ~2s runtime per test, runs via `npm run test:api:emulator`. Uses a distinct firebase-admin app name (`sanction-integration`) so the suite does not collide with the other emulator suite's admin app cache.

### 3.1 Why these tests exist alongside the unit suite

The unit suite mocks `runTransaction` as a pass-through that calls the callback once with a stub `tx`. That is enough to prove the *shape* of the claim logic but cannot prove its *semantics*:

1. **Real transactional retry**: two concurrent `claimBatch` calls over a 10-doc pool. With Firestore's real write-contention retry loop, one transaction aborts on the losing read, its callback re-runs, and the re-query skips the newly-flipped docs. Under the mock, both claims would read the same 5 docs and both would "succeed" with overlapping sets.
2. **Real batch atomicity**: if `finalizeWinner` is ever refactored to split the winner write from the lease clears into two commits, the unit suite still passes (mock writes go to an in-memory array, partial commits look identical). The emulator suite catches it because a partial commit leaves a mixed-state collection that the follow-up assertion reads back.
3. **Real index usage**: the `(evaluated ASC, timestamp ASC)` composite in `firestore.indexes.json` must exist for the claim query. The emulator does not enforce the index (unlike production) but running the query round-trip against real data still catches field-name drift (`evaluated` renamed to `is_evaluated` etc.).
4. **Sweep TTL arithmetic**: the unit suite stubs `Timestamp.fromMillis`; the emulator suite round-trips real Firestore timestamps, proving the TTL comparison works against the stored representation (not just against stub values).

### 3.2 Test cases

**`claimBatch` (emulator)**
- Below-threshold pool (4 docs) → `claimBatch` returns `[]`, no doc has `evaluated=true` after. Proves the all-or-nothing guarantee against real Firestore (not just against the transaction mock).
- 7-doc pool → claim returns the 5 oldest by `timestamp` ascending, in insertion order. Proves the `orderBy('timestamp', 'asc')` clause actually orders, and that `MIN_BATCH` of those ids flip to `evaluated=true`.
- 10-doc pool with two parallel `claimBatch` calls → `Promise.all([claimA, claimB])` must produce disjoint id sets whose union equals the number of docs flipped in Firestore. This is the single most load-bearing test in the whole pipeline: it proves Firestore's write-contention retry loop serializes the two claims correctly. If this test ever flakes, the concurrency invariant is broken and every downstream guarantee is suspect.

**`sweepStaleLeases` (emulator)**
- Seeded pool: 3 docs with an expired lease (`now - TTL - 1s`) + 2 docs with a fresh lease (`now - 1s`). Sweep runs. The 3 expired docs flip back to `evaluated=false, sanction_lease_at=null`; the 2 fresh docs are untouched. Proves the TTL comparison uses the stored `Timestamp` format correctly and does not accidentally clear in-progress claims.

**`finalizeWinner` (emulator)**
- Seed 5 docs, mark them claimed (evaluated=true + active lease), build `batchDocs` from live snapshots, call `finalizeWinner`. Read every doc back. Winner has `sanctioned=true, sanction_count=1, sanction_rationale, impact_score=13, sanction_lease_at=null`. Every loser has `sanction_lease_at=null` AND no rogue sanction fields written. Proves the commit is atomic and the rules-pairing invariant holds through a real batch commit. A refactor that splits the winner commit from the lease commit would leave losers with stale leases and is caught here.

**`runSanctionBatch` (emulator)**
- Full round-trip: seed 5 docs, stub Gemini to pick doc 1, run. Read doc 1 back — `sanctioned=true`. End-to-end happy path against real Firestore.
- No-op: seed 4 docs, run. Returns `{ status: 'no-op' }`, `generateContent` never called, unevaluated pool size unchanged at 4. Proves the short-circuit never flips a single doc.
- **Stranded claim recovery**: seed 5 docs, manually strand them with `evaluated=true` and an expired lease (simulating a previous crash between claim and finalize). Run `runSanctionBatch` with `now` = a point past the TTL. Sweep clears the strand, claim re-acquires the same 5 docs, judge + finalize complete, winner is written. Proves the end-to-end recovery flow from §3 of the system-design doc actually works against real Firestore, not just against a mock that happens to return the right shapes.
- **Gemini failure, claim preserved**: seed 5 docs, stub Gemini to return empty text on every attempt, run. `runSanctionBatch` rethrows. Every seeded doc is `evaluated=true` with an active lease. Proves the failure path leaves recoverable state — no one silently cleared the lease, no one silently flipped docs back to `evaluated=false`. This is the invariant that makes the retry + sweep recovery path load-bearing.

### 3.3 Isolation from the other emulator suite

Both `functions/sanction.integration.test.js` and `scripts/server.analyze.emulator.integration.test.ts` run under `vitest.api-emulator.config.ts`, share the same emulator instance, and both write to `incident_logs`. To prevent cross-contamination, `vitest.api-emulator.config.ts` sets `fileParallelism: false`, `pool: 'forks'`, and `forks: { singleFork: true }` at the top level of the `test` config so the two files run sequentially in the same worker. `beforeEach` in the sanction suite calls `purgeCollection('incident_logs')` so every test starts from empty state.

The sanction suite is excluded from the default `vitest.config.ts` include pattern to prevent it from being picked up by `npm run test` (which has no emulator running — the test would fail on `FIRESTORE_EMULATOR_HOST` missing).

## 4. Rules / contract tests — `scripts/firestore.rules.integration.test.ts`

Runs against the rules emulator. These tests are unchanged by the sanction rebuild; they keep running green because `firestore.rules` is unchanged. Coverage that matters here:

- Client attempting to write `evaluated` or `sanction_lease_at` is rejected by the default-deny update rule. Neither field appears in any `hasOnly()` allowlist, so the update is denied even if the client passes an otherwise-valid counter bump. This is the rules-level guarantee that only the Admin SDK (sanction function + `persistIncident`) can touch these fields.
- Client attempting to write `sanctioned`, `sanction_rationale`, `sanction_count`, or `impact_score` is still rejected — these existed pre-rebuild and the guards are pre-existing.
- Counter bumps (`breach_count`, `escalation_count`) paired with `impact_score` still work. Counter without `impact_score` still fails.

No new rules test is required because we did not add a new writer or a new allowed field on the client side. The rules contract for the new fields is implicit default-deny.

## 5. Regression — existing server tests

Two existing test files gained one new assertion each to guard against a regression where `persistIncident` forgets to initialize the new fields:

**`scripts/server.analyze.integration.test.ts`** — mocked-admin integration test for the `/api/analyze` POST path. The `writeBatch.set` call is asserted to include `evaluated: false` and `sanction_lease_at: null` in the incident document payload. Without this initialization a brand-new doc would not match the claim query (because the query filters on `evaluated == false` and a missing field is not matched by an equality filter) and sanction judging would silently skip every new incident until a backfill ran.

**`scripts/server.analyze.emulator.integration.test.ts`** — emulator-backed end-to-end test for the same path. Same new assertion, verified against a live Firestore emulator round-trip. This layer catches regressions where the mock test passes (because the mock accepts any payload shape) but the real emulator would reject the write due to an unrelated field-name typo.

Both assertions include a comment explaining that the new fields drive the sanction claim query and must never be omitted on creation.

## 6. Deleted tests

Removed alongside the dying CLI script:

- `scripts/sanction-incidents.test.ts`
- `scripts/sanction-incidents.run.test.ts`

Every branch these tests covered is now exercised by `functions/sanction.test.js` with the pure helpers (`sanitizeRationale`, `parseIncidentDoc`, `normalizeSelection`, `requireNonNegativeCounter`) ported verbatim from the old script. The orchestration tests (`runSanctionBatch`) replace the `sanction-incidents.run.test.ts` coverage with richer assertions, since the new orchestrator has more structure (sweep → claim → judge → finalize instead of a single polling loop with a global run-lock).

## 7. Commands

```bash
# Unit — 204 tests across all unit suites, ~3s
npm run test

# Full emulator suite — sanction integration + server integration, ~20s
npm run test:api:emulator

# Lint / type check
npm run typecheck

# Everything green before a deploy
npm run test && npm run test:api:emulator && npm run typecheck
```

The sanction rebuild definition of done requires all three commands to return zero exit codes locally before any `firebase deploy`.

## 8. What this plan does NOT cover

- **Gemini response quality**. The unit tests mock Gemini; the integration tests mock Gemini; there is no test that calls the real Gemini API with real candidate data and asserts the selection is "reasonable". That is an operator-judgment check done during smoke testing (see `docs/sanction-deploy-checklist.md` §Smoke test).
- **Latency budgets**. No test asserts that a `runSanctionBatch` round-trip completes within N seconds. The `LEASE_TTL_MS = 5 minutes` invariant means a healthy invocation has 5 minutes of headroom before its own claim gets swept — this is a wide margin and does not warrant a latency test.
- **Firestore index creation**. `firebase deploy --only firestore:indexes` is asynchronous and the emulator does not enforce index requirements. The deploy checklist (§Pre-deploy) covers waiting for the `(evaluated ASC, timestamp ASC)` index to build before deploying the function.
- **Secret Manager binding**. The function reads `GEMINI_API_KEY` via `defineSecret(...).value()`. There is no unit test for the binding itself; it is verified during the smoke test by observing that `runSanctionBatch` actually calls Gemini without erroring on missing credentials.

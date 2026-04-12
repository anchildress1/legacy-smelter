# Sanction Judging Patch — Handoff Brief

Scope: patch the existing `functions/sanction.js` built from the prior brief. Scaffold (sweep → claim → judge → finalize, tests, deploy) stays. This doc replaces the **judging prompt**, the **response schema**, the **no-winner escape hatch**, and the **observability policy**. Nothing about the transactional claim flow, lease TTL, or Firestore invariants changes.

Hand this entire file to `/engineering:system-design` + `/engineering:testing-strategy` + `/engineering:deploy-checklist` in the CLI. Do NOT add guidance beyond what is written here. If something is unspecified, ASK — do not guess.

---

## §1 What is wrong with the current prompt

`functions/sanction.js` lines 80–98 is the old rubric. It does not work because:

1. It tells Gemini to reward "screenshot-worthy" writing. That is the same optimization target the analysis prompt in `server.js` already uses. Judging is a no-op — the analysis prompt already pre-selected for that axis, so every candidate ties.
2. It rewards "specific subject references" and "commitment to one premise." Those are accuracy-to-the-source-artifact properties. The source artifact does not exist at judge time. Every incident is a pure-text record; there is nothing external to be faithful to.
3. It implicitly assumes a visual referent exists (the "needlessly ornamental lamp" example lands only because the reader imagines a lamp). The judge has no such referent.

The replacement rubric below judges **only properties internal to the text** — nothing that requires an external referent, nothing that overlaps with the analysis prompt's own optimization targets.

---

## §2 Locked decisions

These are settled. Do not re-ask.

- **Axes are voice-craft only.** Five axes, all orthogonal to the analysis prompt, all computable from the text alone.
- **Penalties are scoring deductions, not disqualifications.** Stackable. Never produce a zero-winner case by disqualification.
- **Zero-shot.** No few-shot examples. Gemini calibrates against its own sense of the axes. Creative freedom is the point.
- **Escape hatch enabled.** Gemini may return `sanctioned_incident_id: null` when nothing in the batch clears a minimum bar. Soft language — "no candidate clearly earned it," not "embarrassed" / "unworthy."
- **Full observability.** Every phase logs start, result, and any non-happy-path reason via `firebase-functions/logger` structured logs. Not just no-winner. Not just errors.
- **One chance only.** No-winner path still marks all 5 `evaluated=true` permanently. Losers never re-enter. (This is already how claim works — the no-winner path just clears leases without writing a winner.)

---

## §3 New `JUDGING_PROMPT` content

Replace the string literal at `functions/sanction.js` lines 80–98 with exactly this. The surrounding `const JUDGING_PROMPT = \`...\`;` shell stays.

```
You are the sanction judge for Legacy Smelter's incident queue.

Five incident records are below. They are pure-text artifacts — there is no external source to check them against, and no one will ever compare them to anything outside this batch. You are not judging accuracy, fidelity, or coverage. You are judging voice craft. Pick the one whose **writing** is the most outrageously funny on its own terms.

Return a single JSON object matching the schema. If a candidate clearly wins, set `sanctioned_incident_id` to its exact `incident_id` and write a one-sentence `sanction_rationale` in institutional voice referencing the specific axis it won on. If no candidate clearly earned it — if the batch is flat, if nothing stands out, if you would be picking at random — set `sanctioned_incident_id` to `null`, leave `sanction_rationale` empty, and explain in `reason` why no incident rose above the rest. The escape hatch is a legitimate outcome. Use it when it is true.

## Axes (score each candidate on all five, then sum)

1. **Tonal overcommitment.** The record sustains a single absurd register — bureaucratic, clinical, forensic, actuarial — through fields that would normally break into a different register. The funnier the mismatch between the register and the subject, the higher the score. A flatter, more committed voice beats a voice that winks at the joke.

2. **Register collision.** Adjacent fields land in registers that do not belong together (clinical `severity` next to deadpan `archive_note`, legal `failure_origin` next to whimsical `chromatic_profile`). The collision itself is the joke. Score the sharpest single collision in the record, not the average.

3. **Declarative compression.** The shortest sentence that still carries the full absurdity wins. Penalize padding. A nine-word `share_quote` that lands beats a twenty-word one that also lands. Compression is the difference between a line you'd quote and a line you'd skim.

4. **Non-sequitur landing.** One field executes a hard left turn the rest of the record did not telegraph — and lands it. Not weird-for-its-own-sake; the turn has to feel earned by the tonal commitment of the surrounding fields. Score zero if the turn feels random instead of earned.

5. **Severity word commitment.** The `severity` value is a clinical or procedural word that is one step too specific for what is being described. "VAPORIZED," "DECOMMISSIONED," "QUARANTINED" beat "CRITICAL," "HIGH," "SEVERE." Score the mismatch between the severity word's usual weight and the subject it is applied to.

## Penalty patterns (each deducts from the total; stack freely)

- **Wink penalty.** The record steps outside its voice to acknowledge the joke. Any phrase that reads as the writer nudging the reader. −1 per occurrence.
- **Generic-institutional penalty.** Fields read like real enterprise boilerplate instead of committed absurdity. "Comprehensive review recommended," "stakeholders notified," etc. −1 per field.
- **Register-drift penalty.** The record starts in one committed register and drifts into another partway through — not a deliberate collision, just inconsistency. −1 total per record.
- **Padding penalty.** Sentences hit length the joke does not earn. −1 per padded sentence.

## Tie-breaking

If two candidates tie on total score, prefer the one with the higher **declarative compression** score. If still tied, pick either — ties are rare at the scoring resolution above.

## Rationale

When `sanctioned_incident_id` is set, `sanction_rationale` is one sentence, institutional voice, maximum 500 characters. It names the specific axis that earned the sanction. Do NOT quote the candidate's own text. Do NOT name the subject matter. Reference the craft, not the content.

When `sanctioned_incident_id` is `null`, `sanction_rationale` is an empty string and `reason` is a one-sentence explanation of what the batch was missing. Soft, not punitive. "No candidate clearly earned the sanction this round" is the tone.
```

---

## §4 New `JUDGING_RESPONSE_SCHEMA`

Replace the schema at lines 100–113. The `Type.OBJECT` / `Type.STRING` / `Type.NULL` imports from `@google/genai` are already in scope.

```js
const JUDGING_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sanctioned_incident_id: {
      type: Type.STRING,
      nullable: true,
      description:
        'The exact incident_id of the single selected incident, or null when no candidate clearly earned the sanction.',
    },
    sanction_rationale: {
      type: Type.STRING,
      description:
        'One-sentence institutional-voice explanation when an incident was selected; empty string when null.',
    },
    reason: {
      type: Type.STRING,
      description:
        'When sanctioned_incident_id is null, one-sentence soft explanation of why the batch produced no winner. Empty string otherwise.',
    },
  },
  required: ['sanctioned_incident_id', 'sanction_rationale', 'reason'],
};
```

Gemini structured output honors `nullable: true` on a primitive-typed field. Do NOT switch the type to a union — that path is not supported by the current `@google/genai` schema validator.

---

## §5 `normalizeSelection` — null-winner path

Current version (lines 211–248) throws when `sanctioned_incident_id` is missing. That is wrong now. Replace with:

- If `sanctioned_incident_id` is `null` (the literal null, not undefined, not empty string):
  - Return `{ sanctioned_incident_id: null, sanction_rationale: '', reason: <sanitized reason string> }`.
  - Require `reason` to be a non-empty string after trimming; throw if missing. The rationale for requiring a reason: we want structured logs to explain every skipped batch, and an empty reason would make the no-winner path indistinguishable from a prompt bug.
- If `sanctioned_incident_id` is a non-empty string:
  - Validate it is in the candidate set (existing behavior).
  - Require `sanction_rationale` to be a non-empty string after `sanitizeRationale` (existing behavior).
  - Return `{ sanctioned_incident_id, sanction_rationale, reason: '' }`.
- Anything else (undefined, empty string, non-string non-null) → throw. The model must commit to one of the two shapes.

Add a helper `sanitizeReason(value)` that mirrors `sanitizeRationale` but caps at 500 characters and is called on the no-winner path.

---

## §6 `judgeBatch` — unchanged control flow

`judgeBatch` itself barely changes. The two-attempt retry loop still runs; `normalizeSelection` now may return a shape with `sanctioned_incident_id: null`; `judgeBatch` passes that through to the caller unchanged.

One addition: after `normalizeSelection` returns, emit a structured log line (see §8) that records which path was taken. Put it in `judgeBatch`, not the caller, so a retry attempt that succeeded on attempt 2 is visible.

---

## §7 Split `finalizeWinner` into two paths

Current `finalizeWinner` (lines 401–440) only knows the winner path. Split into:

- `finalizeWinner({ batchDocs, selection, db })` — unchanged behavior, but only called when `selection.sanctioned_incident_id` is a string. Signature stays; implementation stays.
- `finalizeNoWinner({ batchDocs, selection, db })` — new. Writes a single `WriteBatch` that sets `sanction_lease_at: null` on every doc in `batchDocs`. Does NOT touch `sanctioned`, `sanction_count`, `sanction_rationale`, or `impact_score`. Logs the `reason` field from `selection` via structured log.
- A dispatcher `finalizeBatch({ batchDocs, selection, db })` that inspects `selection.sanctioned_incident_id` and calls the correct path. `runSanctionBatch` calls the dispatcher, never the two leaves directly.

Why split instead of branch inline: tests can target each path independently, and the call-site in `runSanctionBatch` stays flat.

---

## §8 Observability — log every phase

Replace every `console.log` / `console.warn` in `functions/sanction.js` with calls to `firebase-functions/logger`. Import:

```js
import { logger } from 'firebase-functions/v2';
```

Log at these exact points with these exact event names. Every log line is structured (second arg is a plain object).

**Sweep**
- `logger.info('sanction.sweep.start', { now })` — at entry.
- `logger.info('sanction.sweep.recovered', { recoveredCount, now })` — when `recoveredCount > 0`.
- `logger.debug('sanction.sweep.noop', { now })` — when nothing stale.

**Claim**
- `logger.info('sanction.claim.start', { now })` — at entry.
- `logger.info('sanction.claim.success', { batchSize, incidentIds })` — on return with a full batch.
- `logger.info('sanction.claim.short', { available })` — on return with `< MIN_BATCH` docs.
- `logger.warn('sanction.claim.contention', { attempt, error })` — inside the transaction's retry path, if the transaction aborted and is retrying. (Firestore exposes the retry count via its own callback arg; use it.)

**Active-lease check (runSanctionBatch)**
- `logger.warn('sanction.run.short_with_active_leases', { available })` — right before the throw that triggers event-retry.
- `logger.info('sanction.run.noop', { available })` — on the clean no-op return.

**Judge**
- `logger.info('sanction.judge.start', { attempt, incidentIds })` — at the top of every retry-loop iteration.
- `logger.info('sanction.judge.success', { attempt, path: 'winner' | 'no-winner', winnerId: string | null, reason: string | null })` — after `normalizeSelection` returns.
- `logger.warn('sanction.judge.retry', { attempt, error })` — on each caught attempt failure.
- `logger.error('sanction.judge.exhausted', { attempts: MAX_SELECTION_ATTEMPTS, error })` — right before the throw.

**Finalize**
- `logger.info('sanction.finalize.winner', { winnerId, impactScore, batchSize })` — from `finalizeWinner`.
- `logger.info('sanction.finalize.no_winner', { batchSize, incidentIds, reason })` — from `finalizeNoWinner`.

**Orchestrator**
- `logger.info('sanction.run.start', { now })` — first line of `runSanctionBatch`.
- `logger.info('sanction.run.complete', { status, winnerId, path })` — last line, before return. `path` is `winner`, `no-winner`, or absent for `no-op`.

No PII, no user content in the structured log bodies. `incidentIds` is safe — they are Firestore doc IDs. Rationale strings, severity words, archive notes, etc. stay out of logs. If someone later wants to debug a specific judgment, they can read the incident doc directly.

---

## §9 Schema changes — none

No Firestore schema changes. `evaluated`, `sanction_lease_at`, `sanctioned`, `sanction_count`, `sanction_rationale`, `impact_score` all stay. The no-winner path only writes to `sanction_lease_at`. `firestore.rules` needs no update — admin SDK writes bypass rules entirely, and there is no new client-facing field.

The composite index `(evaluated ASC, timestamp ASC)` is still required. If it is missing from `firestore.indexes.json`, add it as part of this patch. If it is already present, skip.

---

## §10 Tests to add or update

In `functions/sanction.test.js`:

1. `normalizeSelection` with `sanctioned_incident_id: null`, non-empty `reason`, empty `sanction_rationale` → returns the no-winner shape.
2. `normalizeSelection` with `sanctioned_incident_id: null`, empty `reason` → throws.
3. `normalizeSelection` with `sanctioned_incident_id: null`, non-empty `sanction_rationale` → returns the no-winner shape, silently drops the rationale (rationale is meaningless on null winner, not an error).
4. `normalizeSelection` with valid winner + non-empty `reason` → returns winner shape, `reason` is empty string in the returned object.
5. Existing winner-path tests stay.
6. `finalizeNoWinner` — fake `batchDocs`, fake `db.batch()`, assert that every doc gets a single `update` call with exactly `{ sanction_lease_at: null }` and nothing else.

In `functions/sanction.integration.test.js` (emulator-backed):

1. Seed 5 unevaluated incidents. Stub `judgeBatch` to return `{ sanctioned_incident_id: null, sanction_rationale: '', reason: 'flat batch' }`. Run `runSanctionBatch`. Assert: all 5 still have `evaluated: true`, all 5 have `sanction_lease_at: null`, none have `sanctioned: true`, none have a mutated `impact_score`, none have a `sanction_rationale`.
2. Seed 5 unevaluated incidents. Stub `judgeBatch` to return a valid winner selection. Run. Assert existing winner-path invariants (already covered).
3. Structured-log assertion: install a `logger` spy, run the no-winner path, assert that `sanction.finalize.no_winner` fired exactly once with the expected `reason`.

---

## §11 Deploy checklist

1. Run `npm --prefix functions run lint && npm --prefix functions test` locally before pushing.
2. Confirm `GEMINI_API_KEY` secret is bound to the function in both projects: `firebase functions:secrets:access GEMINI_API_KEY --project anchildress1-unstable` and `--project anchildress1`. If either errors, stop and fix the secret before deploying.
3. Deploy to `anchildress1-unstable` first. Never `anchildress1` first.
4. Upload 5 test incidents via the running app. Tail `firebase functions:log --project anchildress1-unstable --only sanctionOnIncidentCreate`. Confirm the structured log sequence `sanction.run.start` → `sanction.sweep.*` → `sanction.claim.success` → `sanction.judge.start` → `sanction.judge.success` → `sanction.finalize.winner` OR `sanction.finalize.no_winner` → `sanction.run.complete` appears exactly once per triggering event.
5. Upload a second batch of 5 and confirm the first batch's 5 did not reappear (one-chance invariant).
6. Only after both batches look clean in unstable, deploy to `anchildress1`.
7. Tail prod logs for the first batch in prod. Same sequence check.

---

## §12 Out of scope

- `sanction_count` stays (formula symmetry with the impact-score invariant across `firestore.rules`, `src/types.ts`, `shared/impactScore.js`, `functions/sanction.js`). Removing it is a separate change that touches all four sites. Deferred tech debt.
- `impact_score` computation stays in the admin-side finalize path for the same reason — moving it to React is a separate change that touches the rules file. Deferred.
- Losing images are still not stored. Do not add any image-adjacent field to incidents. Do not reference images in the prompt. Do not propose "visual" heuristics. The text IS the artifact.

---

## §13 Definition of done

- `functions/sanction.js` has the new prompt, new schema, updated `normalizeSelection`, new `finalizeNoWinner`, new `finalizeBatch` dispatcher, and `firebase-functions/v2` logger calls at every phase listed in §8.
- Unit tests from §10 pass locally.
- Emulator integration tests from §10 pass locally.
- Deployed to `anchildress1-unstable`, observed one winner-path batch and one no-winner-path batch in Cloud Logging end-to-end.
- Deployed to `anchildress1`, observed one winner-path batch end-to-end.
- `docs/archive/judging-prompt.md` deleted — it is stale guidance and the new prompt is now source code in `functions/sanction.js`.
- This file (`SANCTION_JUDGING_PATCH.md`) deleted after the patch lands.

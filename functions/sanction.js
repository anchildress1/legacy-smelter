/**
 * Sanction judging logic for Legacy Smelter.
 *
 * Pulled out of the old `scripts/sanction-incidents.ts` CLI runner and
 * reshaped around a transactional claim → judge → finalize flow so it can
 * run as a Cloud Functions v2 Firestore trigger. Every 5 unevaluated
 * incidents are judged as a batch; Gemini selects one winner; losers are
 * permanently out after one batch (one chance only).
 *
 * Invariants (see docs/sanction-rebuild-prompt.md §7):
 *
 *   1. Claim-before-judge. `claimBatch` marks all 5 `evaluated=true` +
 *      `sanction_lease_at=<now>` inside a Firestore transaction BEFORE
 *      Gemini is called. Two concurrent invocations cannot judge
 *      overlapping sets because Firestore aborts the losing transaction
 *      on write contention and retries it — the retry re-reads the query
 *      and grabs the next five unevaluated docs.
 *
 *   2. Finalize is atomic. The winner's `sanctioned=true`,
 *      `sanction_count=1`, `sanction_rationale`, and recomputed
 *      `impact_score` are written in one batch together with
 *      `sanction_lease_at=null` on all five docs. Never write
 *      `impact_score` alone or a counter alone — Firestore rules reject
 *      unpaired counter writes.
 *
 *   3. Failure isolation. A thrown error from `runSanctionBatch` leaves
 *      the claim in place: the 5 docs stay `evaluated=true` with an
 *      active lease. Cloud Functions v2 retries the triggering event; on
 *      the next invocation, `sweepStaleLeases` clears any lease older
 *      than `LEASE_TTL_MS` and the docs re-enter the unevaluated pool.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI, Type } from '@google/genai';

// Impact score weights — intentionally duplicated from shared/impactScore.js.
// Firebase CLI only packages files under functions/ into the Cloud Function
// upload, so `../shared/*` and `file:../shared` package deps both fail at
// container start. The formula is also duplicated in firestore.rules and
// src/types.ts for the same reason (no cross-boundary module sharing). If
// you change these weights, update all four sites together.
const IMPACT_WEIGHTS = Object.freeze({ sanction: 5, escalation: 3, breach: 2 });
function computeImpactScore(counts) {
  const s = Math.max(0, counts.sanction_count);
  const e = Math.max(0, counts.escalation_count);
  const b = Math.max(0, counts.breach_count);
  return IMPACT_WEIGHTS.sanction * s + IMPACT_WEIGHTS.escalation * e + IMPACT_WEIGHTS.breach * b;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const MIN_BATCH = 5;
export const LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_SELECTION_ATTEMPTS = 2;

// Intentionally a stronger model than the /api/analyze path (which uses
// gemini-3.1-flash-lite-preview for fast generation). Judging humor requires
// reasoning the lite model cannot do — it defaults to academic rubric-speak
// regardless of prompt. Full flash has the depth to actually read the batch
// and write a rationale that sounds like a person, not a grading engine.
const GEMINI_MODEL = 'gemini-3.1-pro-preview';

// Named Firestore database — the project writes to `legacy-smelter`, not the
// default `(default)` DB. Must be specified explicitly at every `getFirestore`
// call or the admin SDK talks to the wrong DB.
const FIRESTORE_DATABASE = 'legacy-smelter';

// ── Inlined judging prompt ──────────────────────────────────────────────────

/**
 * Voice-craft judging rubric from docs/sanction-judging-patch.md.
 * Intentionally in source (not loaded from docs) so deploy artifacts pin the
 * exact rubric version and edits are code-reviewed.
 */
const JUDGING_PROMPT = `You are picking the funniest incident report from a batch of five.

These are satire incident reports — real postmortems for uploaded images, written in deadpan enterprise voice. You are judging to pick the funniest most impactful to humans, if one exists. You do not have to select a winner if none would qualify. Read all five, then pick the one that made you laugh hardest. Trust your gut.

Return a single JSON object matching the schema.

## What makes one better than the others

You know it when you see it. But if you need a compass:

- **Commitment.** The best ones never break character. They sustain an absurd register — clinical, forensic, actuarial — so straight-faced that the reader does the laughing. A record that winks at its own joke is worse than one that plays it dead straight.
- **Compression.** Funny is short. A seven-word \`share_quote\` that lands is better than a fifteen-word one that also lands. If a dev would screenshot it and drop it in Slack, that's the one.
- **The turn.** One field does something the rest didn't set up — and sticks the landing. Not random-for-random's-sake, but a hard left that feels earned by the tone around it.
- **Specificity.** "Also, the green paint" beats "Further anomalies detected." The weird concrete detail is always funnier than the generic institutional phrase.

These are instincts, not a rubric. Don't score them. Just read the batch and pick the one a dev would quote to a coworker.

## When nobody wins

If the batch is flat — if nothing stands out, if you'd be flipping a coin — set \`sanctioned_incident_id\` to \`null\`. No winner is a legitimate outcome. Don't force it.

## Writing the rationale

One sentence, max 500 characters. You're a dev who found this funny and is telling a coworker why. Plain words, short, dry.

Examples of the voice:
- "Sustained commitment to procedural language under conditions that did not warrant it."
- "Filed a postmortem for paint drying and somehow made it feel urgent."
- "The phrase 'thermal event' is doing a lot of heavy lifting here."
- "Nobody asked for a root cause analysis of a sandwich. That's what makes it good."

When no winner: leave \`sanction_rationale\` empty. Put a one-sentence explanation in \`reason\`.`;

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

// ── Lazy singletons (admin app + Gemini client) ─────────────────────────────

let _db = null;
let _ai = null;

/**
 * Lazy Firestore handle. Admin SDK `initializeApp()` picks up the service
 * account and project ID from the Cloud Functions runtime environment with
 * no configuration. Called inside handlers so a cold start only pays the
 * init cost once per instance, and tests can inject their own `db` to
 * bypass this path entirely.
 */
export function getDb() {
  if (_db) return _db;
  if (getApps().length === 0) initializeApp();
  _db = getFirestore(FIRESTORE_DATABASE);
  return _db;
}

function getAiClient(apiKey) {
  if (_ai) return _ai;
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

// Test-only seam so unit tests can reset cached singletons between runs.
export function __resetSanctionSingletonsForTests() {
  _db = null;
  _ai = null;
}

// ── Helpers ported verbatim from scripts/sanction-incidents.ts ──────────────

export function sanitizeRationale(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
}

export function sanitizeReason(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
}

function expectIncidentField(data, key, incidentId) {
  const value = data[key];
  if (typeof value !== 'string') {
    throw new TypeError(
      `[sanction] incident_logs/${incidentId} has invalid "${key}" (expected string)`,
    );
  }
  return value;
}

export function parseIncidentDoc(raw, incidentId) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `[sanction] incident_logs/${incidentId} has invalid payload (expected object)`,
    );
  }
  return {
    legacy_infra_class: expectIncidentField(raw, 'legacy_infra_class', incidentId),
    incident_feed_summary: expectIncidentField(raw, 'incident_feed_summary', incidentId),
    share_quote: expectIncidentField(raw, 'share_quote', incidentId),
    diagnosis: expectIncidentField(raw, 'diagnosis', incidentId),
    severity: expectIncidentField(raw, 'severity', incidentId),
    disposition: expectIncidentField(raw, 'disposition', incidentId),
    primary_contamination: expectIncidentField(raw, 'primary_contamination', incidentId),
    contributing_factor: expectIncidentField(raw, 'contributing_factor', incidentId),
    failure_origin: expectIncidentField(raw, 'failure_origin', incidentId),
    archive_note: expectIncidentField(raw, 'archive_note', incidentId),
    chromatic_profile: expectIncidentField(raw, 'chromatic_profile', incidentId),
  };
}

/**
 * Reads a required non-negative finite counter off a candidate doc and throws
 * if the value is missing, non-numeric, non-finite, or negative. Used by
 * `finalizeWinner` so a corrupt counter (e.g. `'x'`, `NaN`, `-3`) can never
 * be silently coerced to zero and written back as a bogus `impact_score`.
 * Crashes loudly — this matches `parseIncidentDoc` and the AGENTS.md
 * invariant that the sanction path never papers over corrupt data.
 */
export function requireNonNegativeCounter(data, key, incidentId) {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `[sanction] incident_logs/${incidentId} has non-finite "${key}" (${String(value)}); refusing to write impact_score.`,
    );
  }
  if (value < 0) {
    throw new RangeError(
      `[sanction] incident_logs/${incidentId} has negative "${key}" (${value}); refusing to write impact_score.`,
    );
  }
  return value;
}

/**
 * Normalizes Gemini's judging response. Throws when the model returned no
 * valid candidate id or no rationale — callers MUST NOT fabricate a judgment.
 * The thrown error message includes the raw response and candidate ids so the
 * operator can tell from Cloud Logging exactly what Gemini said.
 */
export function normalizeSelection(raw, candidates) {
  const candidateIds = new Set(candidates.map((c) => c.incident_id));

  let selectedRaw;
  let rationaleRaw;
  let reasonRaw;
  if (raw && typeof raw === 'object') {
    selectedRaw = raw.sanctioned_incident_id;
    rationaleRaw = raw.sanction_rationale;
    reasonRaw = raw.reason;
  }

  if (selectedRaw === null) {
    const reason = sanitizeReason(reasonRaw);
    if (!reason) {
      throw new Error(
        `[sanction] Model returned no winner without a reason. ` +
          `Raw response: ${JSON.stringify(raw).slice(0, 300)}`,
      );
    }
    return {
      sanctioned_incident_id: null,
      sanction_rationale: '',
      reason,
    };
  }

  if (typeof selectedRaw !== 'string') {
    throw new TypeError(
      `[sanction] Model must return "sanctioned_incident_id" as a non-empty string or null. ` +
        `Candidates: ${candidates.map((c) => c.incident_id).join(', ')}. ` +
        `Raw response: ${JSON.stringify(raw).slice(0, 300)}`,
    );
  }

  const selectedIncidentId = selectedRaw.trim();
  if (!selectedIncidentId) {
    throw new Error(
      `[sanction] Model must return "sanctioned_incident_id" as a non-empty string or null. ` +
        `Candidates: ${candidates.map((c) => c.incident_id).join(', ')}. ` +
        `Raw response: ${JSON.stringify(raw).slice(0, 300)}`,
    );
  }
  if (!candidateIds.has(selectedIncidentId)) {
    throw new Error(
      `[sanction] Model selected non-candidate incident "${selectedIncidentId}". ` +
        `Candidates: ${candidates.map((c) => c.incident_id).join(', ')}.`,
    );
  }

  const sanctionRationale = sanitizeRationale(rationaleRaw);
  if (!sanctionRationale) {
    throw new Error(
      `[sanction] Model selected ${selectedIncidentId} without a rationale. ` +
        `Raw response: ${JSON.stringify(raw).slice(0, 300)}`,
    );
  }

  return {
    sanctioned_incident_id: selectedIncidentId,
    sanction_rationale: sanctionRationale,
    reason: '',
  };
}

// ── Sanction phases ─────────────────────────────────────────────────────────

/**
 * Clear any lease older than `LEASE_TTL_MS` from a previous invocation that
 * crashed between claim and finalize. A doc with a stale lease is stuck —
 * `evaluated=true` excludes it from `claimBatch`, so without recovery it
 * would never re-enter the pool. Idempotent: parallel sweeps write the same
 * values and Firestore last-write-wins keeps everything consistent.
 */
export async function sweepStaleLeases({ now = Date.now(), db = getDb() } = {}) {
  const cutoff = Timestamp.fromMillis(now - LEASE_TTL_MS);
  const staleSnap = await db
    .collection('incident_logs')
    .where('sanction_lease_at', '<', cutoff)
    .get();

  if (staleSnap.empty) return { recoveredCount: 0 };

  const batch = db.batch();
  for (const doc of staleSnap.docs) {
    batch.update(doc.ref, {
      evaluated: false,
      sanction_lease_at: null,
    });
  }
  await batch.commit();

  console.log(`[sanction] Sweep recovered ${staleSnap.size} stale lease(s)`);
  return { recoveredCount: staleSnap.size };
}

/**
 * Transactionally claim the oldest `MIN_BATCH` unevaluated incidents. Marks
 * every claimed doc `evaluated=true` + `sanction_lease_at=<now>` before the
 * transaction commits. Two concurrent invocations cannot claim overlapping
 * sets: Firestore aborts the losing transaction on write contention and the
 * retry re-reads the query, grabbing the next unclaimed five (or returning
 * an empty batch if fewer than five remain).
 *
 * Returns an array of `{ id, ref, data }` snapshots captured before the
 * update. `data` is the pre-claim doc body — that's what downstream stages
 * parse into candidates and recompute `impact_score` from.
 */
export async function claimBatch({ now = Date.now(), db = getDb() } = {}) {
  const leaseTimestamp = Timestamp.fromMillis(now);

  return db.runTransaction(async (tx) => {
    const querySnap = await tx.get(
      db
        .collection('incident_logs')
        .where('evaluated', '==', false)
        .orderBy('timestamp', 'asc')
        .limit(MIN_BATCH),
    );

    if (querySnap.size < MIN_BATCH) return [];

    const claimed = [];
    for (const doc of querySnap.docs) {
      tx.update(doc.ref, {
        evaluated: true,
        sanction_lease_at: leaseTimestamp,
      });
      claimed.push({
        id: doc.id,
        ref: doc.ref,
        data: doc.data(),
      });
    }
    return claimed;
  });
}

/**
 * Returns true when at least one incident currently holds an active (non-null)
 * sanction lease. Used by the run orchestrator to avoid acknowledging a
 * short-batch no-op while a previously claimed batch is still in limbo.
 */
export async function hasActiveLease({ db = getDb() } = {}) {
  const activeLeaseSnap = await db
    .collection('incident_logs')
    .where('sanction_lease_at', '>', Timestamp.fromMillis(0))
    .limit(1)
    .get();
  return !activeLeaseSnap.empty;
}

/**
 * Ask Gemini to pick one candidate from the claimed batch, retrying up to
 * `MAX_SELECTION_ATTEMPTS` times on model errors, empty responses, parse
 * failures, or invalid selections. Throws when every attempt fails — the
 * caller leaves the claim in place so the next invocation's sweep recovers
 * it after the lease TTL.
 *
 * Uses Gemini's structured-output path (`responseMimeType` + `responseSchema`)
 * so the model is hard-constrained to the expected shape. Even so, the
 * response is re-validated by `normalizeSelection` in case the model
 * hallucinates an id outside the provided candidate set.
 */
export async function judgeBatch(candidates, { geminiApiKey, aiClient } = {}) {
  const ai = aiClient ?? getAiClient(geminiApiKey);
  const prompt = `${JUDGING_PROMPT}\n\n## Incidents\n\n${JSON.stringify(candidates, null, 2)}`;

  let lastError;
  for (let attempt = 1; attempt <= MAX_SELECTION_ATTEMPTS; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: JUDGING_RESPONSE_SCHEMA,
        },
      });
      const text = response?.text?.trim();
      if (!text) {
        lastError = new Error(
          `[sanction] Empty Gemini response (attempt ${attempt}/${MAX_SELECTION_ATTEMPTS})`,
        );
        console.warn(lastError.message);
        continue;
      }
      const parsed = JSON.parse(text);
      return normalizeSelection(parsed, candidates);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[sanction] Judging attempt ${attempt}/${MAX_SELECTION_ATTEMPTS} failed: ${msg}`,
      );
    }
  }
  throw new Error(
    `[sanction] Gemini failed to produce a valid selection after ${MAX_SELECTION_ATTEMPTS} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Commit the winner write and clear every claimed doc's lease. The write is
 * atomic in a Firestore `WriteBatch`: winner gets `sanctioned=true`,
 * `sanction_count=1`, `sanction_rationale`, recomputed `impact_score`, and
 * `sanction_lease_at=null`; losers only get `sanction_lease_at=null`.
 *
 * `impact_score` is recomputed from the live `breach_count` and
 * `escalation_count` off the pre-claim doc data because the rules invariant
 * `impact_score == impactScore(data)` is enforced per-write, and writing a
 * stale paired score would fail the invariant. `requireNonNegativeCounter`
 * refuses corrupt counters loudly rather than coercing them to zero.
 */
export async function finalizeWinner({ batchDocs, selection, db = getDb() }) {
  const winnerDoc = batchDocs.find((d) => d.id === selection.sanctioned_incident_id);
  if (!winnerDoc) {
    throw new Error(
      `[sanction] Selected incident ${selection.sanctioned_incident_id} is not in the batch ` +
        `(${batchDocs.map((d) => d.id).join(', ')}).`,
    );
  }

  const breachCount = requireNonNegativeCounter(winnerDoc.data, 'breach_count', winnerDoc.id);
  const escalationCount = requireNonNegativeCounter(
    winnerDoc.data,
    'escalation_count',
    winnerDoc.id,
  );
  const impactScore = computeImpactScore({
    sanction_count: 1,
    escalation_count: escalationCount,
    breach_count: breachCount,
  });

  const batch = db.batch();
  batch.update(winnerDoc.ref, {
    sanctioned: true,
    sanction_count: 1,
    sanction_rationale: selection.sanction_rationale,
    impact_score: impactScore,
    sanction_lease_at: null,
  });
  for (const doc of batchDocs) {
    if (doc.id === winnerDoc.id) continue;
    batch.update(doc.ref, { sanction_lease_at: null });
  }
  await batch.commit();

  console.log(
    `[sanction] Finalized winner ${winnerDoc.id} (impact_score=${impactScore}, batch_size=${batchDocs.length})`,
  );
  return { winnerId: winnerDoc.id, impactScore, path: 'winner' };
}

/**
 * Commit a no-winner round: clear leases on all claimed docs and preserve all
 * sanction/counter fields exactly as-is.
 */
export async function finalizeNoWinner({ batchDocs, selection, db = getDb() }) {
  const batch = db.batch();
  for (const doc of batchDocs) {
    batch.update(doc.ref, { sanction_lease_at: null });
  }
  await batch.commit();

  console.log(
    `[sanction] Finalized no-winner batch (batch_size=${batchDocs.length}, reason=${selection.reason})`,
  );
  return { winnerId: null, impactScore: null, path: 'no-winner' };
}

export async function finalizeBatch({ batchDocs, selection, db = getDb() }) {
  if (selection.sanctioned_incident_id === null) {
    return finalizeNoWinner({ batchDocs, selection, db });
  }
  return finalizeWinner({ batchDocs, selection, db });
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Full sanction flow: sweep → claim → judge → finalize. Called from the
 * Cloud Functions v2 Firestore trigger on every `incident_logs` create.
 *
 * Exit conditions:
 *   - Fewer than 5 unevaluated docs + no active leases →
 *     `{ status: 'no-op' }`, function returns cleanly and waits for more
 *     uploads.
 *   - Fewer than 5 unevaluated docs + active leases → throws so Cloud
 *     Functions retry keeps running until a lease expires and sweep can
 *     recover the stranded claim.
 *   - Batch judged + finalized → `{ status: 'completed', winnerId }`.
 *   - Any throw inside judge or finalize → surfaced to the trigger, which
 *     rethrows to activate Cloud Functions v2 event retry. Claim stays in
 *     place; next invocation's sweep recovers the stale lease after the
 *     TTL elapses.
 */
export async function runSanctionBatch({ geminiApiKey, aiClient, db, now = Date.now() } = {}) {
  const dbHandle = db ?? getDb();

  await sweepStaleLeases({ now, db: dbHandle });

  const batchDocs = await claimBatch({ now, db: dbHandle });
  if (batchDocs.length < MIN_BATCH) {
    const activeLeaseExists = await hasActiveLease({ db: dbHandle });
    if (activeLeaseExists) {
      throw new Error(
        `[sanction] Fewer than ${MIN_BATCH} unevaluated incidents and active leases still exist; retrying until lease recovery.`,
      );
    }
    console.log(
      `[sanction] Fewer than ${MIN_BATCH} unevaluated incidents (${batchDocs.length}); skipping.`,
    );
    return { status: 'no-op' };
  }

  const candidates = batchDocs.map((doc) => ({
    ...parseIncidentDoc(doc.data, doc.id),
    incident_id: doc.id,
  }));

  console.log(
    `[sanction] Claimed batch: ${candidates.map((c) => c.incident_id).join(', ')}`,
  );

  const selection = await judgeBatch(candidates, { geminiApiKey, aiClient });
  const result = await finalizeBatch({ batchDocs, selection, db: dbHandle });

  return { status: 'completed', ...result };
}

// Expose for tests that need to reference the FieldValue sentinel without
// re-importing firebase-admin. Intentionally not part of the module's
// public API beyond the test surface.
export const __internals = { FieldValue };

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
// Resolved via functions/package.json's `"@legacy-smelter/shared": "file:../shared"`
// dependency. Firebase CLI vendors the linked files into the upload at deploy
// time, so the running container sees `node_modules/@legacy-smelter/shared/...`
// instead of a parent-directory relative path that would fall outside the
// functions source root.
import { computeImpactScore } from '@legacy-smelter/shared/impactScore.js';

// ── Constants ───────────────────────────────────────────────────────────────

export const MIN_BATCH = 5;
export const LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_SELECTION_ATTEMPTS = 2;

// Same Gemini model the /api/analyze path uses. Pinning both to one model ID
// means a model-lifecycle change (deprecation, quota split) hits both callers
// together instead of silently drifting the judging pipeline off the analysis
// pipeline's contract.
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

// Named Firestore database — the project writes to `legacy-smelter`, not the
// default `(default)` DB. Must be specified explicitly at every `getFirestore`
// call or the admin SDK talks to the wrong DB.
const FIRESTORE_DATABASE = 'legacy-smelter';

// ── Inlined judging prompt ──────────────────────────────────────────────────

/**
 * JUDGING_PROMPT is written fresh from the criteria in
 * `docs/archive/judging-prompt.md`. Not a copy — optimized for Gemini's
 * structured-output schema path, tightened to match the voice of the
 * `GEMINI_PROMPT` constant in `server.js`, and reshaped so the candidate
 * incidents are appended as a JSON block at call time. Do NOT `readFileSync`
 * the archive file — keeping the prompt as source code means a deploy
 * necessarily captures the prompt version, and a prompt edit is a commit the
 * review pipeline sees.
 */
const JUDGING_PROMPT = `You are the AI sanction engine for Legacy Smelter's incident queue.

Five incident reports are below. Exactly one must be sanctioned. "Sanctioned" means: this is the incident a developer would screenshot and send to a coworker. Pick the one that would stop someone scrolling.

Return a single JSON object matching the schema. Use the exact \`incident_id\` value from the records as \`sanctioned_incident_id\`. Do not invent IDs. Do not return more than one.

## Selection criteria (in order of weight)

1. Classification hook. \`legacy_infra_class\` names something specific and unexpected. Immediately legible — you read it and know exactly what kind of artifact this is. Strong: "DESKTOP FAUNA INCIDENT". Weak: "HUMAN-INTEGRATED WORKSPACE NODE".

2. Best single line. The one sentence in \`archive_note\` or \`failure_origin\` that would survive being screenshotted out of context. Flat, specific, deadpan observations. "The lamp is needlessly ornamental" lands. Generic enterprise language does not.

3. Severity word. \`severity\` is clinical, unexpected, slightly too specific for the situation. Unexpected escalation of a mundane subject is the mechanic. "VAPORIZED" beats "CRITICAL".

4. Commitment. The incident stays on one specific premise across every field. Specific subject references beat generic institutional language.

## Rationale

\`sanction_rationale\` is one sentence, institutional voice. Reference the specific detail that earned the sanction — not the category. Maximum 500 characters.`;

const JUDGING_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sanctioned_incident_id: {
      type: Type.STRING,
      description: 'The exact incident_id of the single selected incident.',
    },
    sanction_rationale: {
      type: Type.STRING,
      description: 'One-sentence institutional-voice explanation of why this incident was selected.',
    },
  },
  required: ['sanctioned_incident_id', 'sanction_rationale'],
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
    uid: expectIncidentField(raw, 'uid', incidentId),
    legacy_infra_class: expectIncidentField(raw, 'legacy_infra_class', incidentId),
    diagnosis: expectIncidentField(raw, 'diagnosis', incidentId),
    severity: expectIncidentField(raw, 'severity', incidentId),
    archive_note: expectIncidentField(raw, 'archive_note', incidentId),
    failure_origin: expectIncidentField(raw, 'failure_origin', incidentId),
    chromatic_profile: expectIncidentField(raw, 'chromatic_profile', incidentId),
    incident_feed_summary: expectIncidentField(raw, 'incident_feed_summary', incidentId),
    share_quote: expectIncidentField(raw, 'share_quote', incidentId),
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
  if (raw && typeof raw === 'object') {
    selectedRaw = raw.sanctioned_incident_id;
    rationaleRaw = raw.sanction_rationale ?? raw.rationale;
  }

  const selectedIncidentId = typeof selectedRaw === 'string' ? selectedRaw.trim() : '';
  if (!selectedIncidentId) {
    throw new Error(
      `[sanction] Model must return "sanctioned_incident_id". ` +
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
  return { winnerId: winnerDoc.id, impactScore };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Full sanction flow: sweep → claim → judge → finalize. Called from the
 * Cloud Functions v2 Firestore trigger on every `incident_logs` create.
 *
 * Exit conditions:
 *   - Fewer than 5 unevaluated docs → `{ status: 'no-op' }`, function
 *     returns cleanly and waits for more uploads.
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
  const result = await finalizeWinner({ batchDocs, selection, db: dbHandle });

  return { status: 'completed', ...result };
}

// Expose for tests that need to reference the FieldValue sentinel without
// re-importing firebase-admin. Intentionally not part of the module's
// public API beyond the test surface.
export const __internals = { FieldValue };

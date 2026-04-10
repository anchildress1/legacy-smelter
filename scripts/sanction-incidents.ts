/**
 * AI sanction script.
 *
 * Every full batch of 5 unevaluated incidents is sent to Gemini. Gemini
 * selects exactly one incident to receive a sanction; the other four are
 * marked "reviewed but not selected" so they won't be re-queried in future
 * runs.
 *
 * "Unevaluated" is identified by `sanction_rationale === null`. Once the
 * sanction job touches a doc, it always sets a non-null rationale: either
 * Gemini's actual rationale (when sanctioned), the not-selected marker
 * (when reviewed and passed over), or the schema-quarantine marker (when
 * malformed).
 *
 * Run: npx tsx scripts/sanction-incidents.ts
 * Env: GEMINI_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 */

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData, DocumentReference, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db } from './lib/admin-init.js';
import { computeImpactScore } from '../shared/impactScore.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MIN_BATCH = 5;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const LOCK_COLLECTION = 'system_locks';
const LOCK_DOC_ID = 'sanction-incidents';
const LOCK_TTL_MS = 8 * 60 * 1000;
const RUN_ID = randomUUID();
const SCHEMA_QUARANTINE_RATIONALE = 'Skipped by sanction job: invalid incident schema.';
const NOT_SELECTED_RATIONALE = 'Reviewed by sanction job: not selected for sanction.';
const MAX_SELECTION_ATTEMPTS = 2;
const MAX_REQUERY_ITERATIONS = 3;
const MIGRATION_COLLECTION = 'system_migrations';
const MIGRATION_DOC_ID = 'voting-fields-v1';
const MIGRATION_SCAN_PAGE_SIZE = 500;

if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

const __dirname = dirname(fileURLToPath(import.meta.url));
const JUDGING_PROMPT = readFileSync(resolve(__dirname, '../docs/judging-prompt.md'), 'utf-8');

interface IncidentDoc {
  uid: string;
  legacy_infra_class: string;
  diagnosis: string;
  severity: string;
  archive_note: string;
  failure_origin: string;
  chromatic_profile: string;
  system_dx: string;
  incident_feed_summary: string;
  share_quote: string;
}

type Candidate = IncidentDoc & { incident_id: string };

interface SanctionSelection {
  sanctioned_incident_id: string;
  sanction_rationale: string;
}


function getLockRef(): DocumentReference<DocumentData> {
  return db.collection(LOCK_COLLECTION).doc(LOCK_DOC_ID);
}

async function acquireRunLock(): Promise<boolean> {
  const lockRef = getLockRef();
  const now = Date.now();
  const lockExpiresAt = now + LOCK_TTL_MS;

  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(lockRef);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const expiresAt = typeof data.lock_expires_at_ms === 'number' ? data.lock_expires_at_ms : 0;

    if (expiresAt > now) return false;

    tx.set(lockRef, {
      run_id: RUN_ID,
      lock_expires_at_ms: lockExpiresAt,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function refreshRunLock(): Promise<void> {
  const lockRef = getLockRef();
  const now = Date.now();
  const lockExpiresAt = now + LOCK_TTL_MS;

  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(lockRef);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    if (data.run_id !== RUN_ID) {
      throw new Error('Run lock lost to another process');
    }
    tx.set(lockRef, {
      lock_expires_at_ms: lockExpiresAt,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function releaseRunLock(): Promise<void> {
  const lockRef = getLockRef();
  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(lockRef);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    if (data.run_id !== RUN_ID) return;

    tx.set(lockRef, {
      run_id: FieldValue.delete(),
      lock_expires_at_ms: 0,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function sanitizeRationale(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
}


function expectIncidentField(data: Record<string, unknown>, key: keyof IncidentDoc, incidentId: string): string {
  const value = data[key];
  if (typeof value !== 'string') {
    throw new Error(`[sanction-incidents] incident_logs/${incidentId} has invalid "${key}" (expected string)`);
  }
  return value;
}

function parseIncidentDoc(raw: unknown, incidentId: string): IncidentDoc {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[sanction-incidents] incident_logs/${incidentId} has invalid payload (expected object)`);
  }
  const data = raw as Record<string, unknown>;
  return {
    uid: expectIncidentField(data, 'uid', incidentId),
    legacy_infra_class: expectIncidentField(data, 'legacy_infra_class', incidentId),
    diagnosis: expectIncidentField(data, 'diagnosis', incidentId),
    severity: expectIncidentField(data, 'severity', incidentId),
    archive_note: expectIncidentField(data, 'archive_note', incidentId),
    failure_origin: expectIncidentField(data, 'failure_origin', incidentId),
    chromatic_profile: expectIncidentField(data, 'chromatic_profile', incidentId),
    system_dx: expectIncidentField(data, 'system_dx', incidentId),
    incident_feed_summary: expectIncidentField(data, 'incident_feed_summary', incidentId),
    share_quote: expectIncidentField(data, 'share_quote', incidentId),
  };
}

function hasValidVotingFields(data: Record<string, unknown>): boolean {
  return (
    typeof data.breach_count === 'number' &&
    Number.isFinite(data.breach_count) &&
    typeof data.escalation_count === 'number' &&
    Number.isFinite(data.escalation_count) &&
    typeof data.sanction_count === 'number' &&
    Number.isFinite(data.sanction_count) &&
    typeof data.sanctioned === 'boolean' &&
    (data.sanction_rationale === null || typeof data.sanction_rationale === 'string')
  );
}

function readFiniteNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function ensureVotingFieldsMigration(): Promise<void> {
  const markerRef = db.collection(MIGRATION_COLLECTION).doc(MIGRATION_DOC_ID);
  const markerSnap = await markerRef.get();
  if (markerSnap.exists) return;

  console.warn(
    `[sanction-incidents] Migration marker ${MIGRATION_COLLECTION}/${MIGRATION_DOC_ID} missing; validating incident_logs schema.`
  );

  let scannedCount = 0;
  let invalidCount = 0;
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    let queryRef = db
      .collection('incident_logs')
      .orderBy('__name__')
      .select(
        'breach_count',
        'escalation_count',
        'sanction_count',
        'sanctioned',
        'sanction_rationale'
      )
      .limit(MIGRATION_SCAN_PAGE_SIZE);

    if (cursor) queryRef = queryRef.startAfter(cursor);

    const pageSnap = await queryRef.get();
    if (pageSnap.empty) break;

    scannedCount += pageSnap.size;
    for (const d of pageSnap.docs) {
      if (!hasValidVotingFields(d.data() as Record<string, unknown>)) invalidCount += 1;
    }

    cursor = pageSnap.docs[pageSnap.docs.length - 1];
  }

  if (invalidCount > 0) {
    throw new Error(
      `[sanction-incidents] Missing migration marker and found ${invalidCount} incident(s) without voting fields. Run: npx tsx scripts/backfill-voting-fields.ts`
    );
  }

  await markerRef.set({
    completed_at: FieldValue.serverTimestamp(),
    scanned_count: scannedCount,
    patched_count: 0,
    source: 'scripts/sanction-incidents.ts preflight',
  }, { merge: true });

  console.warn(
    `[sanction-incidents] Migration marker created after validating ${scannedCount} incident(s).`
  );
}

/**
 * Normalizes Gemini's judging response to a SanctionSelection.
 * Throws if the model returned no valid selection or no rationale — callers
 * MUST NOT fabricate a judgment.
 */
function normalizeSelection(raw: unknown, candidates: Candidate[]): SanctionSelection {
  const candidateIds = new Set(candidates.map((c) => c.incident_id));

  let selectedRaw: unknown;
  let rationaleRaw: unknown;

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    selectedRaw = obj.sanctioned_incident_id;
    rationaleRaw = obj.sanction_rationale ?? obj.rationale;
  }

  let selectedIncidentId = typeof selectedRaw === 'string' ? selectedRaw.trim() : '';

  if (!selectedIncidentId) {
    throw new Error(
      `[sanction-incidents] Model must return "sanctioned_incident_id". ` +
      `Candidates: ${candidates.map((c) => c.incident_id).join(', ')}. ` +
      `Raw response: ${JSON.stringify(raw).slice(0, 300)}`
    );
  }
  if (!candidateIds.has(selectedIncidentId)) {
    throw new Error(
      `[sanction-incidents] Model selected non-candidate incident "${selectedIncidentId}". ` +
      `Candidates: ${candidates.map((c) => c.incident_id).join(', ')}.`
    );
  }

  const sanctionRationale = sanitizeRationale(rationaleRaw);
  if (!sanctionRationale) {
    throw new Error(
      `[sanction-incidents] Model selected ${selectedIncidentId} without a rationale. ` +
      `Raw response: ${JSON.stringify(raw).slice(0, 300)}`
    );
  }

  return {
    sanctioned_incident_id: selectedIncidentId,
    sanction_rationale: sanctionRationale,
  };
}

async function run(): Promise<void> {
  console.log('[sanction-incidents] Starting run...');
  await ensureVotingFieldsMigration();
  const lockAcquired = await acquireRunLock();
  if (!lockAcquired) {
    console.log('[sanction-incidents] Another run is in progress; exiting.');
    return;
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let processedBatches = 0;
  let requeryIterations = 0;

  try {
    // Keep processing full groups of 5 so sanctions do not lag during bursts.
    while (true) {
      if (requeryIterations > MAX_REQUERY_ITERATIONS) {
        console.error(
          `[sanction-incidents] Re-query loop exceeded ${MAX_REQUERY_ITERATIONS} iterations ` +
          `without a full candidate batch. Exiting to avoid pipeline stall.`
        );
        return;
      }
      await refreshRunLock();

      // Unevaluated docs are identified by sanction_rationale === null.
      // Once the job touches a doc it always sets a non-null rationale, so
      // this query naturally excludes anything we've already processed.
      const unevaluatedSnap = await db
        .collection('incident_logs')
        .where('sanction_rationale', '==', null)
        .orderBy('timestamp', 'asc')
        .limit(MIN_BATCH)
        .get();

      console.log(`[sanction-incidents] ${unevaluatedSnap.size} unevaluated incident(s) (limit ${MIN_BATCH})`);

      if (unevaluatedSnap.size < MIN_BATCH) {
        if (processedBatches === 0) {
          console.log(`[sanction-incidents] < ${MIN_BATCH} unevaluated — skipping, will retry next run.`);
        } else {
          console.log(`[sanction-incidents] Completed ${processedBatches} batch(es); waiting for the next 5 incidents.`);
        }
        return;
      }

      const batch = unevaluatedSnap.docs;
      const candidates: Candidate[] = [];
      const malformedDocs: typeof batch = [];

      for (const d of batch) {
        try {
          candidates.push({
            ...parseIncidentDoc(d.data(), d.id),
            incident_id: d.id,
          });
        } catch (err) {
          malformedDocs.push(d);
          console.error(
            `[sanction-incidents] Quarantining malformed incident_logs/${d.id}:`,
            err
          );
        }
      }

      if (malformedDocs.length > 0) {
        const quarantineBatch = db.batch();
        for (const d of malformedDocs) {
          const data = d.data() as Record<string, unknown>;
          const breachCount = readFiniteNumber(data, 'breach_count');
          const escalationCount = readFiniteNumber(data, 'escalation_count');
          // Normalize every strict-schema numeric/boolean field so the
          // client-side parseSmeltLog can at least render the quarantined
          // doc instead of hiding it forever. String fields that were
          // malformed cannot be recovered automatically — those stay as-is
          // and parseSmeltLog will still reject them, but at minimum the
          // counter fields are now sane. The non-null sanction_rationale
          // marker also excludes the doc from future unevaluated queries.
          quarantineBatch.update(d.ref, {
            sanctioned: false,
            breach_count: breachCount,
            escalation_count: escalationCount,
            sanction_count: 0,
            sanction_rationale: SCHEMA_QUARANTINE_RATIONALE,
            impact_score: computeImpactScore({
              sanction_count: 0,
              escalation_count: escalationCount,
              breach_count: breachCount,
            }),
          });
        }
        await quarantineBatch.commit();
        console.warn(
          `[sanction-incidents] Quarantined ${malformedDocs.length} malformed incident(s); continuing run.`
        );
      }

      if (candidates.length < MIN_BATCH) {
        // Query limit is fixed to MIN_BATCH. If we quarantined malformed docs,
        // this pass may no longer have a full valid candidate set. Re-query,
        // but bound the loop so a persistent consistency lag or a stuck
        // upstream cannot spin forever.
        requeryIterations++;
        continue;
      }
      // Reset on successful full batch — the counter bounds *consecutive*
      // re-queries, not total across the run.
      requeryIterations = 0;

      console.log('[sanction-incidents] Candidates:', candidates.map((c) => c.incident_id));

      const prompt = `${JUDGING_PROMPT}\n\n## Incidents\n\n${JSON.stringify(candidates, null, 2)}`;
      let selection: SanctionSelection | null = null;
      for (let attempt = 1; attempt <= MAX_SELECTION_ATTEMPTS && !selection; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: [{ parts: [{ text: prompt }] }],
            config: { responseMimeType: 'application/json' },
          });
          const responseText = response.text?.trim();
          if (!responseText) {
            console.error(
              `[sanction-incidents] Empty Gemini response (attempt ${attempt}/${MAX_SELECTION_ATTEMPTS}).`
            );
            continue;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(responseText);
          } catch (parseErr) {
            console.error(
              `[sanction-incidents] Failed to parse Gemini response (attempt ${attempt}/${MAX_SELECTION_ATTEMPTS}):`,
              parseErr
            );
            continue;
          }

          try {
            selection = normalizeSelection(parsed, candidates);
          } catch (selectionErr) {
            console.error(
              `[sanction-incidents] Invalid Gemini selection (attempt ${attempt}/${MAX_SELECTION_ATTEMPTS}):`,
              selectionErr
            );
          }
        } catch (modelErr) {
          console.error(
            `[sanction-incidents] Gemini call failed (attempt ${attempt}/${MAX_SELECTION_ATTEMPTS}):`,
            modelErr
          );
        }
      }

      const candidateDocsById = new Map(batch.map((d) => [d.id, d]));

      if (!selection) {
        // The script no longer marks individual docs as "permanently
        // failed" — without the old `judged` flag there is no field left
        // to carry that signal without polluting the rationale text.
        // Instead we throw and let the operator investigate. Re-running
        // the job picks the same batch back up because nothing was
        // mutated.
        throw new Error(
          `[sanction-incidents] Model failed to produce a valid sanction selection after ${MAX_SELECTION_ATTEMPTS} attempt(s).`
        );
      }

      console.log(`[sanction-incidents] Sanctioned incident: ${selection.sanctioned_incident_id}`);
      console.log(`[sanction-incidents] Rationale: ${selection.sanction_rationale}`);

      // Every doc in the batch gets a non-null sanction_rationale: the AI
      // rationale for the sanctioned doc, or NOT_SELECTED_RATIONALE for
      // the four that were reviewed and passed over. This excludes them
      // from future unevaluated queries — there is no separate "judged"
      // boolean anymore.
      const writeBatch = db.batch();
      for (const candidate of candidates) {
        const d = candidateDocsById.get(candidate.incident_id);
        if (!d) continue;
        const isSanctioned = d.id === selection.sanctioned_incident_id;
        const data = d.data() as Record<string, unknown>;
        const breachCount = readFiniteNumber(data, 'breach_count');
        const escalationCount = readFiniteNumber(data, 'escalation_count');
        const sanctionCount = isSanctioned ? 1 : 0;
        writeBatch.update(d.ref, {
          sanctioned: isSanctioned,
          sanction_count: sanctionCount,
          sanction_rationale: isSanctioned ? selection.sanction_rationale : NOT_SELECTED_RATIONALE,
          impact_score: computeImpactScore({
            sanction_count: sanctionCount,
            escalation_count: escalationCount,
            breach_count: breachCount,
          }),
        });
      }

      await writeBatch.commit();
      processedBatches += 1;
      await refreshRunLock();

      console.log(`[sanction-incidents] Batch ${processedBatches} committed.`);
    }
  } finally {
    try {
      await releaseRunLock();
    } catch (releaseErr) {
      console.warn('[sanction-incidents] Failed to release run lock:', releaseErr);
    }
  }
}

run().catch((err) => {
  console.error('[sanction-incidents] Fatal error:', err);
  process.exit(1);
});

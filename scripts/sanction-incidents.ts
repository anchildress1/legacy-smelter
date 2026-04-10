/**
 * AI sanction script.
 *
 * Pulls batches of 5 not-yet-sanctioned incidents and asks Gemini to pick
 * exactly one to sanction. The selected doc flips to `sanctioned: true`
 * with a rationale; the other four stay `sanctioned: false` and become
 * eligible for the next run's batch (re-competing against fresh
 * incidents). There is no "evaluated but not selected" middle state —
 * `sanctioned` is the single source of truth.
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
const MAX_SELECTION_ATTEMPTS = 2;
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
    throw new TypeError(`[sanction-incidents] incident_logs/${incidentId} has invalid "${key}" (expected string)`);
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

    cursor = pageSnap.docs.at(-1)!;
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

  try {
    // Keep processing full groups of 5 so sanctions do not lag during bursts.
    while (true) {
      await refreshRunLock();

      // Pull the oldest 5 not-yet-sanctioned incidents. Non-selected docs
      // from previous runs stay sanctioned: false and re-enter this query
      // until they either win a batch or never do.
      const unsanctionedSnap = await db
        .collection('incident_logs')
        .where('sanctioned', '==', false)
        .orderBy('timestamp', 'asc')
        .limit(MIN_BATCH)
        .get();

      console.log(`[sanction-incidents] ${unsanctionedSnap.size} unsanctioned incident(s) (limit ${MIN_BATCH})`);

      if (unsanctionedSnap.size < MIN_BATCH) {
        if (processedBatches === 0) {
          console.log(`[sanction-incidents] < ${MIN_BATCH} unsanctioned — skipping, will retry next run.`);
        } else {
          console.log(`[sanction-incidents] Completed ${processedBatches} batch(es); waiting for the next 5 incidents.`);
        }
        return;
      }

      const batch = unsanctionedSnap.docs;
      const candidates: Candidate[] = [];

      for (const d of batch) {
        try {
          candidates.push({
            ...parseIncidentDoc(d.data(), d.id),
            incident_id: d.id,
          });
        } catch (err) {
          // Malformed docs cannot be silently quarantined any more —
          // there is no "evaluated but not selected" marker without
          // `judged`. Crash loudly so the operator can fix the offending
          // doc instead of having the script paper over corrupt data.
          throw new Error(
            `[sanction-incidents] incident_logs/${d.id} failed to parse: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

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

      if (!selection) {
        // Re-running picks the same batch back up because nothing was
        // mutated.
        throw new Error(
          `[sanction-incidents] Model failed to produce a valid sanction selection after ${MAX_SELECTION_ATTEMPTS} attempt(s).`
        );
      }

      console.log(`[sanction-incidents] Sanctioned incident: ${selection.sanctioned_incident_id}`);
      console.log(`[sanction-incidents] Rationale: ${selection.sanction_rationale}`);

      // Only the selected doc is mutated. The other four stay
      // sanctioned: false and re-enter the query on the next run,
      // competing fresh against the next batch of incidents.
      const selectedDoc = batch.find((d) => d.id === selection.sanctioned_incident_id);
      if (!selectedDoc) {
        throw new Error(
          `[sanction-incidents] Selected incident ${selection.sanctioned_incident_id} is not in the candidate batch.`
        );
      }
      const selectedData = selectedDoc.data() as Record<string, unknown>;
      const breachCount = readFiniteNumber(selectedData, 'breach_count');
      const escalationCount = readFiniteNumber(selectedData, 'escalation_count');
      const writeBatch = db.batch();
      writeBatch.update(selectedDoc.ref, {
        sanctioned: true,
        sanction_count: 1,
        sanction_rationale: selection.sanction_rationale,
        impact_score: computeImpactScore({
          sanction_count: 1,
          escalation_count: escalationCount,
          breach_count: breachCount,
        }),
      });

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

try {
  await run();
} catch (err) {
  console.error('[sanction-incidents] Fatal error:', err);
  process.exit(1);
}

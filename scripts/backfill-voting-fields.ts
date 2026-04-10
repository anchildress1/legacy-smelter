/**
 * One-time backfill: adds the voting/sanction fields to any incident_logs
 * documents that predate the field-strict schema. Also recomputes
 * `impact_score = 5×sanction_count + 3×escalation_count + 2×breach_count`
 * and patches any doc whose stored value is missing, non-finite, or drifted
 * from the formula.
 *
 * Run: npx tsx scripts/backfill-voting-fields.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 *
 * Document writes are idempotent — only docs actually missing a field (or
 * with stale impact_score) are patched. The migration marker at
 * system_migrations/voting-fields-v1 preserves its original `first_run_at`
 * timestamp across re-runs, and every run appends an immutable entry to
 * the `runs` subcollection so the audit trail is never destroyed.
 */

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { db } from './lib/admin-init.js';
import { computeImpactScore } from '../shared/impactScore.js';

const BATCH_LIMIT = 400;
const READ_PAGE_SIZE = 500;
const MIGRATION_COLLECTION = 'system_migrations';
const MIGRATION_DOC_ID = 'voting-fields-v1';
const RUN_ID = randomUUID();

const REQUIRED_DEFAULTS = {
  breach_count: 0,
  escalation_count: 0,
  sanction_count: 0,
  sanctioned: false,
  sanction_rationale: null,
} as const;

function resolveFiniteNumber(
  data: Record<string, unknown>,
  updates: Record<string, unknown>,
  key: 'breach_count' | 'escalation_count' | 'sanction_count'
): number {
  const fromUpdate = updates[key];
  if (typeof fromUpdate === 'number' && Number.isFinite(fromUpdate)) return fromUpdate;
  const fromData = data[key];
  if (typeof fromData === 'number' && Number.isFinite(fromData)) return fromData;
  return 0;
}

async function run(): Promise<void> {
  console.log(`[backfill] Scanning incident_logs collection…`);

  let patched = 0;
  let scanned = 0;
  let batch = db.batch();
  let batchSize = 0;
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    let queryRef = db
      .collection('incident_logs')
      .orderBy('__name__')
      .limit(READ_PAGE_SIZE);
    if (cursor) queryRef = queryRef.startAfter(cursor);

    const pageSnap = await queryRef.get();
    if (pageSnap.empty) break;

    scanned += pageSnap.size;

    for (const doc of pageSnap.docs) {
      const data = doc.data();
      const updates: Record<string, unknown> = {};

      for (const [field, defaultValue] of Object.entries(REQUIRED_DEFAULTS)) {
        const value = data[field];
        if (field === 'sanction_rationale') {
          if (value !== null && typeof value !== 'string') updates[field] = defaultValue;
        } else if (typeof defaultValue === 'number') {
          if (typeof value !== 'number' || !Number.isFinite(value)) updates[field] = defaultValue;
        } else if (typeof defaultValue === 'boolean') {
          if (typeof value !== 'boolean') updates[field] = defaultValue;
        }
      }

      const breachCount = resolveFiniteNumber(data, updates, 'breach_count');
      const escalationCount = resolveFiniteNumber(data, updates, 'escalation_count');
      const sanctionCount = resolveFiniteNumber(data, updates, 'sanction_count');
      const impactScore = computeImpactScore({
        sanction_count: sanctionCount,
        escalation_count: escalationCount,
        breach_count: breachCount,
      });
      const currentImpact = data.impact_score;
      if (typeof currentImpact !== 'number' || !Number.isFinite(currentImpact) || currentImpact !== impactScore) {
        updates.impact_score = impactScore;
      }

      if (Object.keys(updates).length === 0) continue;

      console.log(`[backfill] ${doc.id} <- ${JSON.stringify(updates)}`);
      batch.update(doc.ref, updates);
      patched++;
      batchSize++;

      if (batchSize >= BATCH_LIMIT) {
        await batch.commit();
        console.log(`[backfill] Committed batch of ${batchSize}`);
        batch = db.batch();
        batchSize = 0;
      }
    }

    cursor = pageSnap.docs[pageSnap.docs.length - 1];
  }

  if (batchSize > 0) {
    await batch.commit();
    console.log(`[backfill] Committed final batch of ${batchSize}`);
  }

  console.log(`[backfill] ${scanned} documents scanned`);
  if (patched === 0) {
    console.log(`[backfill] All ${scanned} documents already conform. No changes.`);
  } else {
    console.log(`[backfill] Patched ${patched} document(s) out of ${scanned}.`);
  }

  // Append an immutable run entry so the audit trail is preserved across
  // re-runs. The top-level marker doc records `first_run_at` once and
  // `last_run_at` on every run; the `runs` subcollection holds the full
  // history keyed by RUN_ID.
  const markerRef = db.collection(MIGRATION_COLLECTION).doc(MIGRATION_DOC_ID);
  const runRef = markerRef.collection('runs').doc(RUN_ID);
  const now = FieldValue.serverTimestamp();
  await runRef.set({
    run_id: RUN_ID,
    completed_at: now,
    scanned_count: scanned,
    patched_count: patched,
    source: 'scripts/backfill-voting-fields.ts',
  });
  // merge: true lets us initialize first_run_at on the first run and
  // preserve it on subsequent runs. last_run_at always rolls forward.
  const markerSnap = await markerRef.get();
  const markerUpdate: Record<string, unknown> = {
    last_run_at: now,
    last_run_id: RUN_ID,
    last_scanned_count: scanned,
    last_patched_count: patched,
  };
  if (!markerSnap.exists || !markerSnap.data()?.first_run_at) {
    markerUpdate.first_run_at = now;
    markerUpdate.first_run_id = RUN_ID;
  }
  await markerRef.set(markerUpdate, { merge: true });
  console.log(`[backfill] Marked migration ${MIGRATION_COLLECTION}/${MIGRATION_DOC_ID} run ${RUN_ID} as complete.`);
}

run().catch((err) => {
  console.error('[backfill] Fatal:', err);
  process.exit(1);
});

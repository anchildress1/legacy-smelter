/**
 * One-time backfill: adds the sanction-trigger claim-state fields
 * (`evaluated: false`, `sanction_lease_at: null`) to any incident_logs
 * documents that predate the sanction-rebuild schema. Without this,
 * pre-rebuild docs have neither field present and would never be pulled
 * into `claimBatch` (whose where-filter is `evaluated == false`), leaving
 * them permanently orphaned from the judging pipeline.
 *
 * Run: npx tsx scripts/backfill-evaluated.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 *
 * Idempotent: only docs missing the `evaluated` or `sanction_lease_at`
 * fields are patched. Already-patched docs are left alone, so re-running
 * after a partial failure is safe. The migration marker at
 * system_migrations/sanction-evaluated-v1 preserves its original
 * `first_run_at` timestamp across re-runs; every run appends an immutable
 * audit entry to the `runs` subcollection.
 *
 * Semantics of the default values:
 *   - `evaluated: false` — pre-rebuild docs have never been seen by the
 *     judging pipeline, so they are by definition unevaluated and eligible
 *     for a future batch. Setting them to `true` would silently exclude
 *     historical incidents from ever winning a sanction.
 *   - `sanction_lease_at: null` — no lease is held. `claimBatch` is the
 *     only writer that sets this non-null.
 */

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData, QueryDocumentSnapshot, WriteBatch } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { db } from './lib/admin-init.js';

const BATCH_LIMIT = 400;
const READ_PAGE_SIZE = 500;
const MIGRATION_COLLECTION = 'system_migrations';
const MIGRATION_DOC_ID = 'sanction-evaluated-v1';
const RUN_ID = randomUUID();

interface BackfillState {
  batch: WriteBatch;
  batchSize: number;
  scanned: number;
  patched: number;
}

/**
 * Returns the patch for a single doc or `null` if no fields are missing.
 * A doc is considered complete iff both keys are present with the correct
 * primitive shape (`evaluated` is a boolean, `sanction_lease_at` is either
 * `null` or a Firestore Timestamp object). Wrong-type values are treated
 * as missing and patched back to the safe default — they would otherwise
 * silently break `claimBatch`'s query filter or the sweep's `<` comparator.
 */
function buildDocPatch(data: Record<string, unknown>): Record<string, unknown> | null {
  const updates: Record<string, unknown> = {};

  if (typeof data.evaluated !== 'boolean') {
    updates.evaluated = false;
  }

  // `sanction_lease_at` may be `null` (cleared) or a Firestore Timestamp
  // (active lease). Anything else — including `undefined` on pre-rebuild
  // docs — is wrong and gets reset to null.
  const leaseValue = data.sanction_lease_at;
  const isValidLease =
    leaseValue === null ||
    (typeof leaseValue === 'object' &&
      leaseValue !== null &&
      typeof (leaseValue as { toMillis?: unknown }).toMillis === 'function');
  if (!isValidLease) {
    updates.sanction_lease_at = null;
  }

  return Object.keys(updates).length === 0 ? null : updates;
}

async function flushBatchIfFull(state: BackfillState): Promise<void> {
  if (state.batchSize < BATCH_LIMIT) return;
  await state.batch.commit();
  console.log(`[backfill-evaluated] Committed batch of ${state.batchSize}`);
  state.batch = db.batch();
  state.batchSize = 0;
}

async function backfillPage(
  docs: QueryDocumentSnapshot<DocumentData>[],
  state: BackfillState,
): Promise<void> {
  for (const doc of docs) {
    const updates = buildDocPatch(doc.data());
    if (!updates) continue;
    console.log(`[backfill-evaluated] ${doc.id} <- ${JSON.stringify(updates)}`);
    state.batch.update(doc.ref, updates);
    state.patched++;
    state.batchSize++;
    await flushBatchIfFull(state);
  }
}

async function fetchNextPage(
  cursor: QueryDocumentSnapshot<DocumentData> | null,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  let queryRef = db
    .collection('incident_logs')
    .orderBy('__name__')
    .limit(READ_PAGE_SIZE);
  if (cursor) queryRef = queryRef.startAfter(cursor);
  const pageSnap = await queryRef.get();
  return pageSnap.docs;
}

async function recordMigrationRun(scanned: number, patched: number): Promise<void> {
  const markerRef = db.collection(MIGRATION_COLLECTION).doc(MIGRATION_DOC_ID);
  const runRef = markerRef.collection('runs').doc(RUN_ID);
  const now = FieldValue.serverTimestamp();
  await runRef.set({
    run_id: RUN_ID,
    completed_at: now,
    scanned_count: scanned,
    patched_count: patched,
    source: 'scripts/backfill-evaluated.ts',
  });
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
  console.log(
    `[backfill-evaluated] Marked migration ${MIGRATION_COLLECTION}/${MIGRATION_DOC_ID} run ${RUN_ID} as complete.`,
  );
}

async function run(): Promise<void> {
  console.log(`[backfill-evaluated] Scanning incident_logs collection…`);

  const state: BackfillState = {
    batch: db.batch(),
    batchSize: 0,
    scanned: 0,
    patched: 0,
  };
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    const pageDocs = await fetchNextPage(cursor);
    if (pageDocs.length === 0) break;

    state.scanned += pageDocs.length;
    await backfillPage(pageDocs, state);
    cursor = pageDocs.at(-1)!;
  }

  if (state.batchSize > 0) {
    await state.batch.commit();
    console.log(`[backfill-evaluated] Committed final batch of ${state.batchSize}`);
  }

  console.log(`[backfill-evaluated] ${state.scanned} documents scanned`);
  if (state.patched === 0) {
    console.log(
      `[backfill-evaluated] All ${state.scanned} documents already conform. No changes.`,
    );
  } else {
    console.log(
      `[backfill-evaluated] Patched ${state.patched} document(s) out of ${state.scanned}.`,
    );
  }

  await recordMigrationRun(state.scanned, state.patched);
}

try {
  await run();
} catch (err) {
  console.error('[backfill-evaluated] Fatal:', err);
  process.exit(1);
}

/**
 * Shared runner for one-shot `incident_logs` backfill migrations.
 *
 * The pagination loop, write-batch flushing, migration-marker write, and
 * per-run audit-log append are identical across every backfill script we
 * write, so they live here. Each script only supplies its own per-doc patch
 * function plus metadata (migration id, source path, log prefix).
 *
 * Contract for `buildDocPatch`: return the updates to merge into the doc,
 * or `null` when the doc already conforms and no write is needed. A `null`
 * return is the fast path — the runner will not enqueue a batch write for
 * that doc, which keeps idempotent re-runs cheap.
 *
 * Migration marker semantics: `first_run_at` + `first_run_id` are written
 * on the first run and preserved across re-runs; `last_run_*` rolls forward
 * on every run. Every run also appends an immutable entry to
 * `system_migrations/<migrationDocId>/runs/<RUN_ID>` so the audit trail is
 * never destroyed.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData, QueryDocumentSnapshot, WriteBatch } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { db } from './admin-init.js';

const BATCH_LIMIT = 400;
const READ_PAGE_SIZE = 500;
const MIGRATION_COLLECTION = 'system_migrations';
const TARGET_COLLECTION = 'incident_logs';

export interface BackfillRunnerOptions {
  /** Document id under `system_migrations/` for the marker + audit log. */
  migrationDocId: string;
  /** Script path recorded on every run entry (audit trail provenance). */
  source: string;
  /** Prefix used on every console log line from the runner. */
  logPrefix: string;
  /**
   * Per-doc patch builder. Return the updates to merge into the doc, or
   * `null` if the doc already conforms. Called once per scanned doc.
   */
  buildDocPatch: (data: Record<string, unknown>) => Record<string, unknown> | null;
}

interface BackfillState {
  batch: WriteBatch;
  batchSize: number;
  scanned: number;
  patched: number;
}

export async function runIncidentBackfill(options: BackfillRunnerOptions): Promise<void> {
  const { migrationDocId, source, logPrefix, buildDocPatch } = options;
  const runId = randomUUID();

  console.log(`[${logPrefix}] Scanning ${TARGET_COLLECTION} collection…`);

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
    await backfillPage(pageDocs, state, buildDocPatch, logPrefix);
    cursor = pageDocs.at(-1)!;
  }

  if (state.batchSize > 0) {
    await state.batch.commit();
    console.log(`[${logPrefix}] Committed final batch of ${state.batchSize}`);
  }

  console.log(`[${logPrefix}] ${state.scanned} documents scanned`);
  if (state.patched === 0) {
    console.log(
      `[${logPrefix}] All ${state.scanned} documents already conform. No changes.`,
    );
  } else {
    console.log(
      `[${logPrefix}] Patched ${state.patched} document(s) out of ${state.scanned}.`,
    );
  }

  await recordMigrationRun({
    runId,
    scanned: state.scanned,
    patched: state.patched,
    migrationDocId,
    source,
    logPrefix,
  });
}

async function fetchNextPage(
  cursor: QueryDocumentSnapshot<DocumentData> | null,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  let queryRef = db
    .collection(TARGET_COLLECTION)
    .orderBy('__name__')
    .limit(READ_PAGE_SIZE);
  if (cursor) queryRef = queryRef.startAfter(cursor);
  const pageSnap = await queryRef.get();
  return pageSnap.docs;
}

async function backfillPage(
  docs: QueryDocumentSnapshot<DocumentData>[],
  state: BackfillState,
  buildDocPatch: BackfillRunnerOptions['buildDocPatch'],
  logPrefix: string,
): Promise<void> {
  for (const doc of docs) {
    const updates = buildDocPatch(doc.data());
    if (!updates) continue;
    console.log(`[${logPrefix}] ${doc.id} <- ${JSON.stringify(updates)}`);
    state.batch.update(doc.ref, updates);
    state.patched++;
    state.batchSize++;
    await flushBatchIfFull(state, logPrefix);
  }
}

async function flushBatchIfFull(state: BackfillState, logPrefix: string): Promise<void> {
  if (state.batchSize < BATCH_LIMIT) return;
  await state.batch.commit();
  console.log(`[${logPrefix}] Committed batch of ${state.batchSize}`);
  state.batch = db.batch();
  state.batchSize = 0;
}

interface RecordRunOptions {
  runId: string;
  scanned: number;
  patched: number;
  migrationDocId: string;
  source: string;
  logPrefix: string;
}

async function recordMigrationRun(opts: RecordRunOptions): Promise<void> {
  const { runId, scanned, patched, migrationDocId, source, logPrefix } = opts;
  const markerRef = db.collection(MIGRATION_COLLECTION).doc(migrationDocId);
  const runRef = markerRef.collection('runs').doc(runId);
  const now = FieldValue.serverTimestamp();

  await runRef.set({
    run_id: runId,
    completed_at: now,
    scanned_count: scanned,
    patched_count: patched,
    source,
  });

  const markerSnap = await markerRef.get();
  const markerUpdate: Record<string, unknown> = {
    last_run_at: now,
    last_run_id: runId,
    last_scanned_count: scanned,
    last_patched_count: patched,
  };
  if (!markerSnap.exists || !markerSnap.data()?.first_run_at) {
    markerUpdate.first_run_at = now;
    markerUpdate.first_run_id = runId;
  }
  await markerRef.set(markerUpdate, { merge: true });

  console.log(
    `[${logPrefix}] Marked migration ${MIGRATION_COLLECTION}/${migrationDocId} run ${runId} as complete.`,
  );
}

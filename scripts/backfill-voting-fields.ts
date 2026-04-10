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
import type { DocumentData, QueryDocumentSnapshot, WriteBatch } from 'firebase-admin/firestore';
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

type CounterKey = 'breach_count' | 'escalation_count' | 'sanction_count';

interface BackfillState {
  batch: WriteBatch;
  batchSize: number;
  scanned: number;
  patched: number;
}

function resolveFiniteNumber(
  data: Record<string, unknown>,
  updates: Record<string, unknown>,
  key: CounterKey,
): number {
  const fromUpdate = updates[key];
  if (typeof fromUpdate === 'number' && Number.isFinite(fromUpdate)) return fromUpdate;
  const fromData = data[key];
  if (typeof fromData === 'number' && Number.isFinite(fromData)) return fromData;
  return 0;
}

/**
 * Decides whether a single field needs a default filled in. Returns the
 * default value when it does, or `undefined` when the existing value is
 * acceptable. Keeping the per-field type-check out of the main loop is
 * what drops the enclosing `run()` under the cognitive-complexity ceiling.
 */
function missingDefaultFor(
  field: keyof typeof REQUIRED_DEFAULTS,
  value: unknown,
): unknown {
  const defaultValue = REQUIRED_DEFAULTS[field];
  if (field === 'sanction_rationale') {
    return value !== null && typeof value !== 'string' ? defaultValue : undefined;
  }
  if (typeof defaultValue === 'number') {
    return typeof value !== 'number' || !Number.isFinite(value) ? defaultValue : undefined;
  }
  if (typeof defaultValue === 'boolean') {
    return typeof value !== 'boolean' ? defaultValue : undefined;
  }
  return undefined;
}

function collectDefaultUpdates(data: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of Object.keys(REQUIRED_DEFAULTS) as (keyof typeof REQUIRED_DEFAULTS)[]) {
    const patched = missingDefaultFor(field, data[field]);
    if (patched !== undefined) updates[field] = patched;
  }
  return updates;
}

/**
 * Computes the authoritative `impact_score` from the post-update counter
 * values and patches it into `updates` if the stored value is missing,
 * non-finite, or drifted from the weighted sum.
 */
function applyImpactScorePatch(
  data: Record<string, unknown>,
  updates: Record<string, unknown>,
): void {
  const impactScore = computeImpactScore({
    sanction_count: resolveFiniteNumber(data, updates, 'sanction_count'),
    escalation_count: resolveFiniteNumber(data, updates, 'escalation_count'),
    breach_count: resolveFiniteNumber(data, updates, 'breach_count'),
  });
  const currentImpact = data.impact_score;
  if (
    typeof currentImpact !== 'number' ||
    !Number.isFinite(currentImpact) ||
    currentImpact !== impactScore
  ) {
    updates.impact_score = impactScore;
  }
}

function buildDocPatch(data: Record<string, unknown>): Record<string, unknown> | null {
  const updates = collectDefaultUpdates(data);
  applyImpactScorePatch(data, updates);
  return Object.keys(updates).length === 0 ? null : updates;
}

async function flushBatchIfFull(state: BackfillState): Promise<void> {
  if (state.batchSize < BATCH_LIMIT) return;
  await state.batch.commit();
  console.log(`[backfill] Committed batch of ${state.batchSize}`);
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
    console.log(`[backfill] ${doc.id} <- ${JSON.stringify(updates)}`);
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
  console.log(
    `[backfill] Marked migration ${MIGRATION_COLLECTION}/${MIGRATION_DOC_ID} run ${RUN_ID} as complete.`,
  );
}

async function run(): Promise<void> {
  console.log(`[backfill] Scanning incident_logs collection…`);

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
    cursor = pageDocs[pageDocs.length - 1];
  }

  if (state.batchSize > 0) {
    await state.batch.commit();
    console.log(`[backfill] Committed final batch of ${state.batchSize}`);
  }

  console.log(`[backfill] ${state.scanned} documents scanned`);
  if (state.patched === 0) {
    console.log(`[backfill] All ${state.scanned} documents already conform. No changes.`);
  } else {
    console.log(`[backfill] Patched ${state.patched} document(s) out of ${state.scanned}.`);
  }

  await recordMigrationRun(state.scanned, state.patched);
}

try {
  await run();
} catch (err) {
  console.error('[backfill] Fatal:', err);
  process.exit(1);
}

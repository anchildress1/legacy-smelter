/**
 * One-shot cleanup: deletes the legacy `system_dx` field from every
 * incident_logs document. The field has been removed from the schema,
 * server writes, parsers, sanction script, blueprint, and UI — this
 * script removes it from existing docs so the data matches the code.
 *
 * `system_dx` was a duplicate of `diagnosis` with a medical/clinical
 * framing that conflicted with the project's institutional voice.
 * `diagnosis` is now the single source of truth and is rendered in
 * the overlay's Diagnostics section.
 *
 * Idempotent. Re-running on a clean collection is a no-op (no doc
 * matches `system_dx != undefined` after the first pass).
 *
 * Run: npx tsx scripts/strip-system-dx-field.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 */

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData, QueryDocumentSnapshot, WriteBatch } from 'firebase-admin/firestore';
import { db } from './lib/admin-init.js';

const READ_PAGE_SIZE = 500;
const BATCH_LIMIT = 400;

interface StripState {
  batch: WriteBatch;
  batchSize: number;
  scanned: number;
  stripped: number;
}

async function flushBatchIfFull(state: StripState): Promise<void> {
  if (state.batchSize < BATCH_LIMIT) return;
  await state.batch.commit();
  console.log(`[strip-system-dx] Committed batch of ${state.batchSize}`);
  state.batch = db.batch();
  state.batchSize = 0;
}

async function stripSystemDxFromPage(
  docs: QueryDocumentSnapshot<DocumentData>[],
  state: StripState,
): Promise<void> {
  for (const doc of docs) {
    if (!Object.hasOwn(doc.data(), 'system_dx')) continue;
    state.batch.update(doc.ref, { system_dx: FieldValue.delete() });
    state.stripped++;
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
    .select('system_dx')
    .limit(READ_PAGE_SIZE);
  if (cursor) queryRef = queryRef.startAfter(cursor);
  const pageSnap = await queryRef.get();
  return pageSnap.docs;
}

async function run(): Promise<void> {
  console.log('[strip-system-dx] Scanning incident_logs for legacy `system_dx` field…');

  const state: StripState = {
    batch: db.batch(),
    batchSize: 0,
    scanned: 0,
    stripped: 0,
  };
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    const pageDocs = await fetchNextPage(cursor);
    if (pageDocs.length === 0) break;

    state.scanned += pageDocs.length;
    await stripSystemDxFromPage(pageDocs, state);
    cursor = pageDocs.at(-1)!;
  }

  if (state.batchSize > 0) {
    await state.batch.commit();
    console.log(`[strip-system-dx] Committed final batch of ${state.batchSize}`);
  }

  console.log(`[strip-system-dx] ${state.scanned} documents scanned`);
  if (state.stripped === 0) {
    console.log('[strip-system-dx] No documents had the legacy `system_dx` field. Nothing to do.');
  } else {
    console.log(`[strip-system-dx] Removed \`system_dx\` from ${state.stripped} document(s).`);
  }
}

try {
  await run();
} catch (err) {
  console.error('[strip-system-dx] Fatal:', err);
  process.exit(1);
}

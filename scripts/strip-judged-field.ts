/**
 * One-shot cleanup: deletes the legacy `judged` field from every
 * incident_logs document. The field has been removed from the schema,
 * server writes, sanction script, and rules — this script removes it
 * from existing docs so the data matches the code.
 *
 * Idempotent. Re-running on a clean collection is a no-op (no doc
 * matches `judged != undefined` after the first pass).
 *
 * Run: npx tsx scripts/strip-judged-field.ts
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
  console.log(`[strip-judged] Committed batch of ${state.batchSize}`);
  state.batch = db.batch();
  state.batchSize = 0;
}

async function stripJudgedFromPage(
  docs: QueryDocumentSnapshot<DocumentData>[],
  state: StripState,
): Promise<void> {
  for (const doc of docs) {
    if (!Object.hasOwn(doc.data(), 'judged')) continue;
    state.batch.update(doc.ref, { judged: FieldValue.delete() });
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
    .select('judged')
    .limit(READ_PAGE_SIZE);
  if (cursor) queryRef = queryRef.startAfter(cursor);
  const pageSnap = await queryRef.get();
  return pageSnap.docs;
}

async function run(): Promise<void> {
  console.log('[strip-judged] Scanning incident_logs for legacy `judged` field…');

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
    await stripJudgedFromPage(pageDocs, state);
    cursor = pageDocs.at(-1)!;
  }

  if (state.batchSize > 0) {
    await state.batch.commit();
    console.log(`[strip-judged] Committed final batch of ${state.batchSize}`);
  }

  console.log(`[strip-judged] ${state.scanned} documents scanned`);
  if (state.stripped === 0) {
    console.log('[strip-judged] No documents had the legacy `judged` field. Nothing to do.');
  } else {
    console.log(`[strip-judged] Removed \`judged\` from ${state.stripped} document(s).`);
  }
}

try {
  await run();
} catch (err) {
  console.error('[strip-judged] Fatal:', err);
  process.exit(1);
}

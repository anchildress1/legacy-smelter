import { FieldValue } from 'firebase-admin/firestore';
import type {
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
  WriteBatch,
} from 'firebase-admin/firestore';

const READ_PAGE_SIZE = 500;
const BATCH_LIMIT = 400;

interface StripState {
  batch: WriteBatch;
  batchSize: number;
  scanned: number;
  stripped: number;
}

interface StripLegacyFieldOptions {
  db: Firestore;
  fieldName: string;
  logPrefix: string;
}

function createInitialState(db: Firestore): StripState {
  return {
    batch: db.batch(),
    batchSize: 0,
    scanned: 0,
    stripped: 0,
  };
}

async function flushBatchIfFull(db: Firestore, logPrefix: string, state: StripState): Promise<void> {
  if (state.batchSize < BATCH_LIMIT) return;
  await state.batch.commit();
  console.log(`[${logPrefix}] Committed batch of ${state.batchSize}`);
  state.batch = db.batch();
  state.batchSize = 0;
}

async function fetchNextPage(
  db: Firestore,
  fieldName: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  let queryRef = db
    .collection('incident_logs')
    .orderBy('__name__')
    .select(fieldName)
    .limit(READ_PAGE_SIZE);
  if (cursor) queryRef = queryRef.startAfter(cursor);
  const pageSnap = await queryRef.get();
  return pageSnap.docs;
}

async function stripFieldFromPage(
  db: Firestore,
  fieldName: string,
  logPrefix: string,
  docs: QueryDocumentSnapshot<DocumentData>[],
  state: StripState,
): Promise<void> {
  for (const doc of docs) {
    if (!Object.hasOwn(doc.data(), fieldName)) continue;
    state.batch.update(doc.ref, { [fieldName]: FieldValue.delete() });
    state.stripped++;
    state.batchSize++;
    await flushBatchIfFull(db, logPrefix, state);
  }
}

function logSummary(logPrefix: string, fieldName: string, state: StripState): void {
  console.log(`[${logPrefix}] ${state.scanned} documents scanned`);
  if (state.stripped === 0) {
    console.log(`[${logPrefix}] No documents had the legacy \`${fieldName}\` field. Nothing to do.`);
    return;
  }

  console.log(`[${logPrefix}] Removed \`${fieldName}\` from ${state.stripped} document(s).`);
}

export async function stripLegacyField({
  db,
  fieldName,
  logPrefix,
}: StripLegacyFieldOptions): Promise<void> {
  console.log(`[${logPrefix}] Scanning incident_logs for legacy \`${fieldName}\` field…`);

  const state = createInitialState(db);
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    const pageDocs = await fetchNextPage(db, fieldName, cursor);
    if (pageDocs.length === 0) break;

    state.scanned += pageDocs.length;
    await stripFieldFromPage(db, fieldName, logPrefix, pageDocs, state);
    cursor = pageDocs.at(-1)!;
  }

  if (state.batchSize > 0) {
    await state.batch.commit();
    console.log(`[${logPrefix}] Committed final batch of ${state.batchSize}`);
  }

  logSummary(logPrefix, fieldName, state);
}

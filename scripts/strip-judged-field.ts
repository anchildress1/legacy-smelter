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
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from './lib/admin-init.js';

const READ_PAGE_SIZE = 500;
const BATCH_LIMIT = 400;

async function run(): Promise<void> {
  console.log('[strip-judged] Scanning incident_logs for legacy `judged` field…');

  let scanned = 0;
  let stripped = 0;
  let batch = db.batch();
  let batchSize = 0;
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    let queryRef = db
      .collection('incident_logs')
      .orderBy('__name__')
      .select('judged')
      .limit(READ_PAGE_SIZE);
    if (cursor) queryRef = queryRef.startAfter(cursor);

    const pageSnap = await queryRef.get();
    if (pageSnap.empty) break;

    scanned += pageSnap.size;

    for (const doc of pageSnap.docs) {
      const data = doc.data();
      if (!Object.prototype.hasOwnProperty.call(data, 'judged')) continue;

      batch.update(doc.ref, { judged: FieldValue.delete() });
      stripped++;
      batchSize++;

      if (batchSize >= BATCH_LIMIT) {
        await batch.commit();
        console.log(`[strip-judged] Committed batch of ${batchSize}`);
        batch = db.batch();
        batchSize = 0;
      }
    }

    cursor = pageSnap.docs[pageSnap.docs.length - 1];
  }

  if (batchSize > 0) {
    await batch.commit();
    console.log(`[strip-judged] Committed final batch of ${batchSize}`);
  }

  console.log(`[strip-judged] ${scanned} documents scanned`);
  if (stripped === 0) {
    console.log('[strip-judged] No documents had the legacy `judged` field. Nothing to do.');
  } else {
    console.log(`[strip-judged] Removed \`judged\` from ${stripped} document(s).`);
  }
}

run().catch((err) => {
  console.error('[strip-judged] Fatal:', err);
  process.exit(1);
});

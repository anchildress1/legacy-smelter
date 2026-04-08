/**
 * One-time backfill: adds `judged: false` and `escalation_count: 0` to any
 * incident_logs documents created before the voting feature was added.
 *
 * Firestore's `where('judged', '==', false)` does NOT match documents that
 * are missing the `judged` field entirely, so without this backfill those
 * old docs are permanently invisible to the audience-favorite cron.
 *
 * Run: npx tsx scripts/backfill-judged.ts
 * Env: same as audience-favorite.ts
 */

import 'dotenv/config';
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_ID = process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

if (!PROJECT_ID) throw new Error('Missing FIREBASE_PROJECT_ID');
if (!DATABASE_ID) throw new Error('Missing FIREBASE_FIRESTORE_DATABASE_ID');

function getServiceAccountCredential(): ServiceAccount | undefined {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) return JSON.parse(json) as ServiceAccount;
  return undefined;
}

const credential = getServiceAccountCredential();
initializeApp(credential ? { credential: cert(credential), projectId: PROJECT_ID } : { projectId: PROJECT_ID });

const db = getFirestore(DATABASE_ID);

async function run(): Promise<void> {
  const allDocs = await db.collection('incident_logs').get();
  let backfilled = 0;

  const batch = db.batch();
  for (const doc of allDocs.docs) {
    const data = doc.data();
    const updates: Record<string, unknown> = {};

    if (data.judged === undefined) updates.judged = false;
    if (data.escalation_count === undefined) updates.escalation_count = 0;

    if (Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);
      backfilled++;
    }
  }

  if (backfilled > 0) {
    await batch.commit();
    console.log(`[backfill-judged] Backfilled ${backfilled} document(s).`);
  } else {
    console.log('[backfill-judged] All documents already have judged + escalation_count. No changes.');
  }
}

run().catch((err) => {
  console.error('[backfill-judged] Fatal error:', err);
  process.exit(1);
});

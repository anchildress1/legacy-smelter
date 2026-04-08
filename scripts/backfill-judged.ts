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
import { db } from './lib/admin-init';

const BATCH_LIMIT = 500;

async function run(): Promise<void> {
  const allDocs = await db.collection('incident_logs').get();
  let backfilled = 0;
  let batch = db.batch();
  let batchSize = 0;

  for (const doc of allDocs.docs) {
    const data = doc.data();
    const updates: Record<string, unknown> = {};

    if (data.judged === undefined) updates.judged = false;
    if (data.escalation_count === undefined) updates.escalation_count = 0;

    if (Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);
      backfilled++;
      batchSize++;

      if (batchSize >= BATCH_LIMIT) {
        await batch.commit();
        console.log(`[backfill-judged] Committed batch of ${batchSize}`);
        batch = db.batch();
        batchSize = 0;
      }
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  if (backfilled > 0) {
    console.log(`[backfill-judged] Backfilled ${backfilled} document(s).`);
  } else {
    console.log('[backfill-judged] All documents already have judged + escalation_count. No changes.');
  }
}

run().catch((err) => {
  console.error('[backfill-judged] Fatal error:', err);
  process.exit(1);
});

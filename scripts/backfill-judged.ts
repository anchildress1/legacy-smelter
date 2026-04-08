/**
 * One-time backfill: adds missing voting/sanction fields to any
 * incident_logs documents created before the voting feature was added.
 *
 * Firestore's `where('judged', '==', false)` does NOT match documents that
 * are missing the `judged` field entirely, so without this backfill those
 * old docs are permanently invisible to the sanction cron.
 *
 * Run: npx tsx scripts/backfill-judged.ts
 * Env: same as sanction-incidents.ts
 */

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
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
    const legacySanctioned = data.audience_favorite === true;
    const effectiveSanctioned = data.sanctioned === true || legacySanctioned;
    const legacyRationale = typeof data.audience_favorite_rationale === 'string'
      ? data.audience_favorite_rationale.trim().slice(0, 500)
      : '';

    if (data.judged === undefined) updates.judged = false;
    if (data.escalation_count === undefined) updates.escalation_count = 0;
    if (data.sanction_count === undefined) {
      updates.sanction_count = effectiveSanctioned ? 1 : 0;
    }
    if (data.sanctioned === undefined || data.sanctioned !== effectiveSanctioned) {
      updates.sanctioned = effectiveSanctioned;
    }
    if (!data.sanction_rationale && effectiveSanctioned && legacyRationale) {
      updates.sanction_rationale = legacyRationale;
    }
    if (!effectiveSanctioned && data.sanction_rationale !== undefined) {
      updates.sanction_rationale = FieldValue.delete();
    }

    if (data.audience_favorite !== undefined) {
      updates.audience_favorite = FieldValue.delete();
    }
    if (data.audience_favorite_rationale !== undefined) {
      updates.audience_favorite_rationale = FieldValue.delete();
    }

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
    console.log('[backfill-judged] All documents already have judged + escalation_count + sanction_count + sanctioned. No changes.');
  }
}

run().catch((err) => {
  console.error('[backfill-judged] Fatal error:', err);
  process.exit(1);
});

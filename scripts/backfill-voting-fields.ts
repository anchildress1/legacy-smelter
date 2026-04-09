/**
 * One-time backfill: adds the voting/sanction fields to any incident_logs
 * documents that predate the field-strict schema.
 *
 * Run: npx tsx scripts/backfill-voting-fields.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 *
 * Safe to re-run: only writes to docs actually missing a field.
 */

import 'dotenv/config';
import { db } from './lib/admin-init.js';

const BATCH_LIMIT = 400;

const REQUIRED_DEFAULTS = {
  breach_count: 0,
  escalation_count: 0,
  sanction_count: 0,
  sanctioned: false,
  judged: false,
  sanction_rationale: null,
} as const;

async function run(): Promise<void> {
  console.log(`[backfill] Scanning incident_logs collection…`);
  const snap = await db.collection('incident_logs').get();
  console.log(`[backfill] ${snap.size} documents total`);

  let patched = 0;
  let batch = db.batch();
  let batchSize = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const updates: Record<string, unknown> = {};

    for (const [field, defaultValue] of Object.entries(REQUIRED_DEFAULTS)) {
      const value = data[field];
      if (field === 'sanction_rationale') {
        if (value !== null && typeof value !== 'string') updates[field] = defaultValue;
      } else if (typeof defaultValue === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) updates[field] = defaultValue;
      } else if (typeof defaultValue === 'boolean') {
        if (typeof value !== 'boolean') updates[field] = defaultValue;
      }
    }

    if (Object.keys(updates).length === 0) continue;

    console.log(`[backfill] ${doc.id} <- ${JSON.stringify(updates)}`);
    batch.update(doc.ref, updates);
    patched++;
    batchSize++;

    if (batchSize >= BATCH_LIMIT) {
      await batch.commit();
      console.log(`[backfill] Committed batch of ${batchSize}`);
      batch = db.batch();
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
    console.log(`[backfill] Committed final batch of ${batchSize}`);
  }

  if (patched === 0) {
    console.log(`[backfill] All ${snap.size} documents already conform. No changes.`);
  } else {
    console.log(`[backfill] Patched ${patched} document(s) out of ${snap.size}.`);
  }
}

run().catch((err) => {
  console.error('[backfill] Fatal:', err);
  process.exit(1);
});

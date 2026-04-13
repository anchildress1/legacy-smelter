#!/usr/bin/env npx tsx
/**
 * Reset sanction state on all incident_logs docs so the judging pipeline
 * can re-run without uploading new images. Clears evaluated, sanctioned,
 * sanction_count, sanction_rationale, sanction_lease_at, and recomputes
 * impact_score. Targets the named `legacy-smelter` database.
 *
 * Uses ambient admin credentials / FIREBASE_PROJECT_ID; set env vars
 * or emulator host before running.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:9180 npx tsx scripts/reset-sanctions.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/reset-sanctions.ts
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { computeImpactScore } from '../shared/impactScore.js';

const DATABASE_ID = 'legacy-smelter';

async function main() {
  if (getApps().length === 0) initializeApp();
  const db = getFirestore(DATABASE_ID);

  const snap = await db
    .collection('incident_logs')
    .orderBy('timestamp', 'asc')
    .get();

  if (snap.empty) {
    console.log('No incident_logs docs found.');
    return;
  }

  console.log(`Found ${snap.size} incident_logs doc(s). Resetting sanction state...`);

  // Known limitation accepted for v2 (tooling script): this uses a single
  // WriteBatch and therefore assumes <=500 docs. If this grows beyond 500,
  // chunk batch commits in a follow-up pass.
  const batch = db.batch();
  let count = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const breachCount = typeof data.breach_count === 'number' ? data.breach_count : 0;
    const escalationCount = typeof data.escalation_count === 'number' ? data.escalation_count : 0;
    const impactScore = computeImpactScore({
      sanction_count: 0,
      escalation_count: escalationCount,
      breach_count: breachCount,
    });

    batch.update(doc.ref, {
      evaluated: false,
      sanctioned: false,
      sanction_count: 0,
      sanction_rationale: null,
      sanction_lease_at: null,
      impact_score: impactScore,
    });
    count++;
  }

  await batch.commit();
  console.log(`Reset ${count} doc(s). Oldest 5 by timestamp will be claimed on next trigger.`);

  // Show the oldest 5 so the user knows which ones will be judged
  const oldest = snap.docs.slice(0, 5);
  console.log('\nOldest 5 (next batch):');
  for (const doc of oldest) {
    const d = doc.data();
    console.log(`  ${doc.id} — ${d.legacy_infra_class} (${d.timestamp?.toDate?.().toISOString() ?? 'no timestamp'})`);
  }
}

try {
  await main();
} catch (err) {
  console.error('Reset failed:', err);
  process.exit(1);
}

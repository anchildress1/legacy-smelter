/**
 * One-time backfill: adds the sanction-trigger claim-state fields
 * (`evaluated: false`, `sanction_lease_at: null`) to any incident_logs
 * documents that predate the sanction-rebuild schema. Without this,
 * pre-rebuild docs have neither field present and would never be pulled
 * into `claimBatch` (whose where-filter is `evaluated == false`), leaving
 * them permanently orphaned from the judging pipeline.
 *
 * Run: npx tsx scripts/backfill-evaluated.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 *
 * Idempotent: only docs missing the `evaluated` or `sanction_lease_at`
 * fields are patched. Already-patched docs are left alone, so re-running
 * after a partial failure is safe. The migration marker at
 * system_migrations/sanction-evaluated-v1 preserves its original
 * `first_run_at` timestamp across re-runs; every run appends an immutable
 * audit entry to the `runs` subcollection.
 *
 * Semantics of the default values:
 *   - `evaluated: false` — pre-rebuild docs have never been seen by the
 *     judging pipeline, so they are by definition unevaluated and eligible
 *     for a future batch. Setting them to `true` would silently exclude
 *     historical incidents from ever winning a sanction.
 *   - `sanction_lease_at: null` — no lease is held. `claimBatch` is the
 *     only writer that sets this non-null.
 */

import 'dotenv/config';
import { runIncidentBackfill } from './lib/backfill-runner.js';

const LOG_PREFIX = 'backfill-evaluated';

/**
 * Returns the patch for a single doc or `null` if no fields are missing.
 * A doc is considered complete iff both keys are present with the correct
 * primitive shape (`evaluated` is a boolean, `sanction_lease_at` is either
 * `null` or a Firestore Timestamp object). Wrong-type values are treated
 * as missing and patched back to the safe default — they would otherwise
 * silently break `claimBatch`'s query filter or the sweep's `<` comparator.
 */
function buildDocPatch(data: Record<string, unknown>): Record<string, unknown> | null {
  const updates: Record<string, unknown> = {};

  if (typeof data.evaluated !== 'boolean') {
    updates.evaluated = false;
  }

  // `sanction_lease_at` may be `null` (cleared) or a Firestore Timestamp
  // (active lease). Anything else — including `undefined` on pre-rebuild
  // docs — is wrong and gets reset to null.
  const leaseValue = data.sanction_lease_at;
  const isValidLease =
    leaseValue === null ||
    (typeof leaseValue === 'object' &&
      leaseValue !== null &&
      typeof (leaseValue as { toMillis?: unknown }).toMillis === 'function');
  if (!isValidLease) {
    updates.sanction_lease_at = null;
  }

  return Object.keys(updates).length === 0 ? null : updates;
}

try {
  await runIncidentBackfill({
    migrationDocId: 'sanction-evaluated-v1',
    source: 'scripts/backfill-evaluated.ts',
    logPrefix: LOG_PREFIX,
    buildDocPatch,
  });
} catch (err) {
  console.error(`[${LOG_PREFIX}] Fatal:`, err);
  process.exit(1);
}

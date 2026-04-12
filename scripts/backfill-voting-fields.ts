/**
 * One-time backfill: adds the voting/sanction fields to any incident_logs
 * documents that predate the field-strict schema. Also recomputes
 * `impact_score = 5×sanction_count + 3×escalation_count + 2×breach_count`
 * and patches any doc whose stored value is missing, non-finite, or drifted
 * from the formula.
 *
 * Run: npx tsx scripts/backfill-voting-fields.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 *
 * Document writes are idempotent — only docs actually missing a field (or
 * with stale impact_score) are patched. The migration marker at
 * system_migrations/voting-fields-v1 preserves its original `first_run_at`
 * timestamp across re-runs, and every run appends an immutable entry to
 * the `runs` subcollection so the audit trail is never destroyed.
 */

import 'dotenv/config';
import { computeImpactScore } from '../shared/impactScore.js';
import { runIncidentBackfill } from './lib/backfill-runner.js';

const LOG_PREFIX = 'backfill';

const REQUIRED_DEFAULTS = {
  breach_count: 0,
  escalation_count: 0,
  sanction_count: 0,
  sanctioned: false,
  sanction_rationale: null,
} as const;

type CounterKey = 'breach_count' | 'escalation_count' | 'sanction_count';

function resolveFiniteNumber(
  data: Record<string, unknown>,
  updates: Record<string, unknown>,
  key: CounterKey,
): number {
  const fromUpdate = updates[key];
  if (typeof fromUpdate === 'number' && Number.isFinite(fromUpdate)) return fromUpdate;
  const fromData = data[key];
  if (typeof fromData === 'number' && Number.isFinite(fromData)) return fromData;
  return 0;
}

/**
 * Decides whether a single field needs a default filled in. Returns the
 * default value when it does, or `undefined` when the existing value is
 * acceptable. Keeping the per-field type-check out of the main loop is
 * what drops the enclosing `run()` under the cognitive-complexity ceiling.
 */
function missingDefaultFor(
  field: keyof typeof REQUIRED_DEFAULTS,
  value: unknown,
): unknown {
  const defaultValue = REQUIRED_DEFAULTS[field];
  if (field === 'sanction_rationale') {
    if (value === null || typeof value === 'string') return undefined;
    return defaultValue;
  }
  if (typeof defaultValue === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return undefined;
    return defaultValue;
  }
  if (typeof defaultValue === 'boolean') {
    if (typeof value === 'boolean') return undefined;
    return defaultValue;
  }
  return undefined;
}

function collectDefaultUpdates(data: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of Object.keys(REQUIRED_DEFAULTS) as (keyof typeof REQUIRED_DEFAULTS)[]) {
    const patched = missingDefaultFor(field, data[field]);
    if (patched !== undefined) updates[field] = patched;
  }
  return updates;
}

/**
 * Computes the authoritative `impact_score` from the post-update counter
 * values and patches it into `updates` if the stored value is missing,
 * non-finite, or drifted from the weighted sum.
 */
function applyImpactScorePatch(
  data: Record<string, unknown>,
  updates: Record<string, unknown>,
): void {
  const impactScore = computeImpactScore({
    sanction_count: resolveFiniteNumber(data, updates, 'sanction_count'),
    escalation_count: resolveFiniteNumber(data, updates, 'escalation_count'),
    breach_count: resolveFiniteNumber(data, updates, 'breach_count'),
  });
  const currentImpact = data.impact_score;
  if (
    typeof currentImpact !== 'number' ||
    !Number.isFinite(currentImpact) ||
    currentImpact !== impactScore
  ) {
    updates.impact_score = impactScore;
  }
}

function buildDocPatch(data: Record<string, unknown>): Record<string, unknown> | null {
  const updates = collectDefaultUpdates(data);
  applyImpactScorePatch(data, updates);
  return Object.keys(updates).length === 0 ? null : updates;
}

try {
  await runIncidentBackfill({
    migrationDocId: 'voting-fields-v1',
    source: 'scripts/backfill-voting-fields.ts',
    logPrefix: LOG_PREFIX,
    buildDocPatch,
  });
} catch (err) {
  console.error(`[${LOG_PREFIX}] Fatal:`, err);
  process.exit(1);
}

/**
 * Impact score weights. Must stay in sync with `src/types.ts::computeImpact`
 * and `firestore.rules::impactScore`. A mismatch causes client writes to be
 * rejected by security rules.
 */
export const IMPACT_WEIGHTS = Object.freeze({
  sanction: 5,
  escalation: 3,
  breach: 2,
});

/**
 * Impact = (5 × sanctions) + (3 × escalations) + (2 × breaches), clamped to 0.
 * Used by server.js, the sanction cron, and the backfill script. Browser
 * code has its own camelCase-compatible copy in src/types.ts.
 *
 * @param {{ sanction_count: number, escalation_count: number, breach_count: number }} counts
 * @returns {number}
 */
export function computeImpactScore(counts) {
  const s = Math.max(0, counts.sanction_count);
  const e = Math.max(0, counts.escalation_count);
  const b = Math.max(0, counts.breach_count);
  return IMPACT_WEIGHTS.sanction * s + IMPACT_WEIGHTS.escalation * e + IMPACT_WEIGHTS.breach * b;
}

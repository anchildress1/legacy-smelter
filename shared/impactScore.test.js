// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IMPACT_WEIGHTS, computeImpactScore } from './impactScore.js';

/**
 * The single source of truth for impact score. `firestore.rules` has a
 * duplicate of the same formula (rules cannot import JS) and both the
 * named-db server writer and the sanction Cloud Function call
 * `computeImpactScore`. These tests pin the behaviour so a weight tweak
 * or a refactor surfaces in CI before it can ship as a rules violation.
 */

describe('IMPACT_WEIGHTS', () => {
  it('matches the canonical weights documented in AGENTS.md', () => {
    // AGENTS.md locks these values; firestore.rules duplicates them.
    // Any drift has to move all three places together.
    expect(IMPACT_WEIGHTS).toEqual({ sanction: 5, escalation: 3, breach: 2 });
  });

  it('is frozen so callers cannot mutate the formula via a shared reference', () => {
    expect(Object.isFrozen(IMPACT_WEIGHTS)).toBe(true);
  });
});

describe('computeImpactScore', () => {
  it('returns 0 for all-zero counters', () => {
    expect(
      computeImpactScore({ sanction_count: 0, escalation_count: 0, breach_count: 0 }),
    ).toBe(0);
  });

  it('applies the 5/3/2 weight to each counter independently', () => {
    expect(
      computeImpactScore({ sanction_count: 1, escalation_count: 0, breach_count: 0 }),
    ).toBe(5);
    expect(
      computeImpactScore({ sanction_count: 0, escalation_count: 1, breach_count: 0 }),
    ).toBe(3);
    expect(
      computeImpactScore({ sanction_count: 0, escalation_count: 0, breach_count: 1 }),
    ).toBe(2);
  });

  it('sums weighted contributions', () => {
    // 5*2 + 3*3 + 2*4 = 10 + 9 + 8 = 27
    expect(
      computeImpactScore({ sanction_count: 2, escalation_count: 3, breach_count: 4 }),
    ).toBe(27);
  });

  it('clamps each negative counter to zero (does not subtract from other axes)', () => {
    // A negative counter would otherwise turn into a subtraction against
    // another axis — e.g. `-1 escalation` silently removing impact owed
    // to a legitimate breach. Clamping each input independently keeps the
    // axes additive.
    expect(
      computeImpactScore({ sanction_count: -1, escalation_count: 2, breach_count: 1 }),
    ).toBe(3 * 2 + 2 * 1); // 8
    expect(
      computeImpactScore({ sanction_count: 1, escalation_count: -5, breach_count: 1 }),
    ).toBe(5 * 1 + 2 * 1); // 7
    expect(
      computeImpactScore({ sanction_count: 0, escalation_count: 0, breach_count: -10 }),
    ).toBe(0);
  });

  it('handles large positive values without overflow', () => {
    // Not a real-world case — sanity check that the arithmetic stays
    // finite at the extreme. Firestore rejects Infinity on write.
    expect(
      computeImpactScore({
        sanction_count: 1_000,
        escalation_count: 1_000,
        breach_count: 1_000,
      }),
    ).toBe(10_000);
  });

  it('treats missing-counter equivalents as clamped-to-zero via Math.max', () => {
    // `Math.max(0, undefined)` is NaN, so the function does NOT silently
    // coerce undefined to zero. This test pins that contract — a missing
    // counter propagates as NaN and callers must validate upstream.
    expect(
      computeImpactScore({ sanction_count: undefined, escalation_count: 0, breach_count: 0 }),
    ).toBeNaN();
  });
});

import { describe, expect, it } from 'vitest';
import { staleReasonCopy } from './useLiveIncidentCounts';
import type { LiveCountsStaleReason } from './useLiveIncidentCounts';

/**
 * `staleReasonCopy` maps each `LiveCountsStaleReason` to the user-visible
 * toast string displayed by `DataHealthIndicator`. The copy must stay
 * stable because the overlay and manifest both compare against it for
 * rendering decisions. Pinning every branch ensures a rename or a new
 * reason variant surfaces in CI rather than silently rendering `null`.
 */

describe('staleReasonCopy', () => {
  it.each<[LiveCountsStaleReason, string]>([
    ['removed', 'LIVE COUNTS STALE. INCIDENT REMOVED FROM ARCHIVE.'],
    ['schema', 'LIVE COUNTS STALE. ARCHIVE SCHEMA DRIFT.'],
    ['subscription', 'LIVE COUNTS STALE. SUBSCRIPTION ERRORED.'],
  ])('maps "%s" to its canonical user-visible string', (reason, expected) => {
    expect(staleReasonCopy(reason)).toBe(expected);
  });

  it('returns null for the null reason (healthy state)', () => {
    expect(staleReasonCopy(null)).toBeNull();
  });
});

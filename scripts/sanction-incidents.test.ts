// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
    batch: vi.fn(),
  },
}));

vi.mock('./lib/admin-init.js', () => ({
  db: mockDb,
}));

import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import {
  hasValidVotingFields,
  normalizeSelection,
  parseIncidentDoc,
  prepareSanctionUpdate,
  requireNonNegativeCounter,
  sanitizeRationale,
  type Candidate,
  type SanctionBatchDoc,
  type SanctionSelection,
} from './sanction-incidents.js';

// Minimal stand-in for the real admin SDK DocumentReference so the strongly-
// typed SanctionBatchDoc contract is exercised without pulling in the full
// firebase-admin runtime. Only the object identity matters for the helper.
function makeRef(path: string): DocumentReference<DocumentData> {
  return { path } as unknown as DocumentReference<DocumentData>;
}

function makeCandidate(id: string): Candidate {
  return {
    incident_id: id,
    uid: 'u',
    legacy_infra_class: 'class',
    diagnosis: 'diag',
    severity: 'high',
    archive_note: 'archive',
    failure_origin: 'origin',
    chromatic_profile: 'profile',
    incident_feed_summary: 'summary',
    share_quote: 'quote',
  };
}

describe('sanction-incidents helpers', () => {
  it('sanitizeRationale trims, caps length to 500 chars, and rejects non-strings', () => {
    expect(sanitizeRationale('  hi  ')).toBe('hi');
    expect(sanitizeRationale('x'.repeat(600))).toHaveLength(500);
    // Exactly 500 chars passes through unchanged (boundary case).
    expect(sanitizeRationale('y'.repeat(500))).toHaveLength(500);
    // 499 chars are preserved exactly (boundary just under the cap).
    expect(sanitizeRationale('z'.repeat(499))).toHaveLength(499);
    // Whitespace-only collapses to empty after trim.
    expect(sanitizeRationale('   ')).toBe('');
    expect(sanitizeRationale(42)).toBe('');
    expect(sanitizeRationale(null)).toBe('');
    expect(sanitizeRationale(undefined)).toBe('');
  });

  it('parseIncidentDoc parses valid incident payloads', () => {
    expect(
      parseIncidentDoc(
        {
          uid: 'u1',
          legacy_infra_class: 'class',
          diagnosis: 'diag',
          severity: 'med',
          archive_note: 'archive',
          failure_origin: 'origin',
          chromatic_profile: 'profile',
          incident_feed_summary: 'summary',
          share_quote: 'quote',
        },
        'inc-1',
      ),
    ).toEqual({
      uid: 'u1',
      legacy_infra_class: 'class',
      diagnosis: 'diag',
      severity: 'med',
      archive_note: 'archive',
      failure_origin: 'origin',
      chromatic_profile: 'profile',
      incident_feed_summary: 'summary',
      share_quote: 'quote',
    });
  });

  it('parseIncidentDoc throws on missing required fields', () => {
    expect(() => parseIncidentDoc({ uid: 'u1' }, 'inc-2')).toThrow(
      '[sanction-incidents] incident_logs/inc-2 has invalid "legacy_infra_class"',
    );
  });

  it('parseIncidentDoc rejects non-object payloads', () => {
    expect(() => parseIncidentDoc(null, 'inc-null')).toThrow(
      '[sanction-incidents] incident_logs/inc-null has invalid payload',
    );
    expect(() => parseIncidentDoc('nope', 'inc-str')).toThrow(
      '[sanction-incidents] incident_logs/inc-str has invalid payload',
    );
    expect(() => parseIncidentDoc(42, 'inc-num')).toThrow(
      '[sanction-incidents] incident_logs/inc-num has invalid payload',
    );
  });

  it('hasValidVotingFields validates positive and negative scenarios', () => {
    expect(
      hasValidVotingFields({
        breach_count: 1,
        escalation_count: 2,
        sanction_count: 3,
        sanctioned: false,
        sanction_rationale: null,
      }),
    ).toBe(true);

    expect(
      hasValidVotingFields({
        breach_count: Number.NaN,
        escalation_count: 2,
        sanction_count: 3,
        sanctioned: false,
        sanction_rationale: null,
      }),
    ).toBe(false);

    expect(
      hasValidVotingFields({
        breach_count: 1,
        escalation_count: 2,
        sanction_count: 3,
        sanctioned: false,
        sanction_rationale: 99,
      }),
    ).toBe(false);
  });

  it('requireNonNegativeCounter returns finite non-negative numbers and throws otherwise', () => {
    expect(requireNonNegativeCounter({ a: 0 }, 'a', 'inc')).toBe(0);
    expect(requireNonNegativeCounter({ a: 7 }, 'a', 'inc')).toBe(7);

    expect(() => requireNonNegativeCounter({}, 'a', 'inc-missing')).toThrow(
      '[sanction-incidents] incident_logs/inc-missing has non-finite "a" (undefined); refusing to write impact_score.',
    );
    expect(() => requireNonNegativeCounter({ a: 'x' }, 'a', 'inc-str')).toThrow(
      'non-finite "a"',
    );
    expect(() => requireNonNegativeCounter({ a: Number.NaN }, 'a', 'inc-nan')).toThrow(
      'non-finite "a"',
    );
    expect(() => requireNonNegativeCounter({ a: Number.POSITIVE_INFINITY }, 'a', 'inc-inf')).toThrow(
      'non-finite "a"',
    );
    expect(() => requireNonNegativeCounter({ a: Number.NEGATIVE_INFINITY }, 'a', 'inc-neg-inf')).toThrow(
      'non-finite "a"',
    );
    expect(() => requireNonNegativeCounter({ a: -1 }, 'a', 'inc-neg')).toThrow(
      '[sanction-incidents] incident_logs/inc-neg has negative "a" (-1); refusing to write impact_score.',
    );
  });

  it('requireNonNegativeCounter treats zero and large finite integers as valid', () => {
    // `-0` is finite and non-negative (`-0 < 0` is false); the helper returns
    // it, which is indistinguishable from `+0` for every downstream consumer
    // (computeImpactScore, Firestore serialization). Use an arithmetic
    // equality check (`=== 0`) instead of `toBe(0)` because Vitest's
    // `toBe` uses `Object.is`, which distinguishes `-0` from `+0`.
    // Pinning the IEEE sign of the zero would lock in an implementation
    // detail unrelated to the invariant being enforced.
    expect(requireNonNegativeCounter({ a: -0 }, 'a', 'inc-neg-zero') === 0).toBe(true);
    expect(requireNonNegativeCounter({ a: +0 }, 'a', 'inc-pos-zero') === 0).toBe(true);

    // `Number.MIN_VALUE` is the smallest *positive* finite double. Must
    // pass the non-negative check even though it is vanishingly small.
    expect(requireNonNegativeCounter({ a: Number.MIN_VALUE }, 'a', 'inc-min')).toBe(
      Number.MIN_VALUE,
    );

    // `MAX_SAFE_INTEGER` is the ceiling for exact integer representation
    // and must flow through — counters in the wild will never reach it,
    // but a refactor that tightened the bound should land deliberately.
    expect(
      requireNonNegativeCounter({ a: Number.MAX_SAFE_INTEGER }, 'a', 'inc-max'),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('normalizeSelection accepts valid candidate and rationale fallback key', () => {
    const candidates = [makeCandidate('inc-a'), makeCandidate('inc-b')];
    expect(
      normalizeSelection({ sanctioned_incident_id: 'inc-a', rationale: '  because  ' }, candidates),
    ).toEqual({
      sanctioned_incident_id: 'inc-a',
      sanction_rationale: 'because',
    });
  });

  it('normalizeSelection rejects missing id, unknown candidate, and missing rationale', () => {
    const candidates = [makeCandidate('inc-a')];

    expect(() => normalizeSelection({}, candidates)).toThrow('Model must return "sanctioned_incident_id"');
    expect(() => normalizeSelection({ sanctioned_incident_id: 'inc-z', sanction_rationale: 'r' }, candidates)).toThrow(
      'Model selected non-candidate incident "inc-z"',
    );
    expect(() => normalizeSelection({ sanctioned_incident_id: 'inc-a', sanction_rationale: '   ' }, candidates)).toThrow(
      'without a rationale',
    );
    // Wrong-typed selection id is treated the same as missing — it cannot be
    // coerced to a candidate match silently.
    expect(() => normalizeSelection({ sanctioned_incident_id: 42, sanction_rationale: 'r' }, candidates)).toThrow(
      'Model must return "sanctioned_incident_id"',
    );
  });

  it('prepareSanctionUpdate returns selected doc update payload with computed impact score', () => {
    const selection: SanctionSelection = {
      sanctioned_incident_id: 'inc-10',
      sanction_rationale: 'serious breach',
    };

    const batch: SanctionBatchDoc[] = [
      {
        id: 'inc-10',
        ref: makeRef('incident_logs/inc-10'),
        data: () => ({ breach_count: 3, escalation_count: 2 }),
      },
    ];
    const { selectedDoc, updatePayload } = prepareSanctionUpdate(batch, selection);

    expect(selectedDoc.id).toBe('inc-10');
    // Identity check — the returned selected doc must be the exact batch entry
    // so the runner forwards its real Firestore ref to writeBatch.update.
    expect(selectedDoc).toBe(batch[0]);
    expect(selectedDoc.ref).toBe(batch[0].ref);
    expect(updatePayload).toEqual({
      sanctioned: true,
      sanction_count: 1,
      sanction_rationale: 'serious breach',
      impact_score: 17,
    });
  });

  it('prepareSanctionUpdate throws when selected doc is absent from the candidate batch', () => {
    const selection: SanctionSelection = {
      sanctioned_incident_id: 'inc-11',
      sanction_rationale: 'reason',
    };

    expect(() =>
      prepareSanctionUpdate(
        [
          {
            id: 'inc-other',
            ref: makeRef('incident_logs/inc-other'),
            data: () => ({ breach_count: 0, escalation_count: 0 }),
          },
        ],
        selection,
      ),
    ).toThrow('Selected incident inc-11 is not in the candidate batch');
  });

  it('prepareSanctionUpdate refuses to write when voting counters are corrupt', () => {
    // Last line of defense before a wrong `impact_score` gets persisted and
    // the doc is flipped to `sanctioned: true` (and thus never re-enters the
    // query). Crash loudly so the operator runs the backfill instead of
    // silently coercing garbage to zero.
    const selection: SanctionSelection = {
      sanctioned_incident_id: 'inc-bad',
      sanction_rationale: 'reason',
    };

    const nanBatch: SanctionBatchDoc[] = [
      {
        id: 'inc-bad',
        ref: makeRef('incident_logs/inc-bad'),
        data: () => ({ breach_count: Number.NaN, escalation_count: 0 }),
      },
    ];
    expect(() => prepareSanctionUpdate(nanBatch, selection)).toThrow(
      'non-finite "breach_count"',
    );

    const stringBatch: SanctionBatchDoc[] = [
      {
        id: 'inc-bad',
        ref: makeRef('incident_logs/inc-bad'),
        data: () => ({ breach_count: 1, escalation_count: 'x' }),
      },
    ];
    expect(() => prepareSanctionUpdate(stringBatch, selection)).toThrow(
      'non-finite "escalation_count"',
    );

    const negativeBatch: SanctionBatchDoc[] = [
      {
        id: 'inc-bad',
        ref: makeRef('incident_logs/inc-bad'),
        data: () => ({ breach_count: -1, escalation_count: 0 }),
      },
    ];
    expect(() => prepareSanctionUpdate(negativeBatch, selection)).toThrow(
      'negative "breach_count"',
    );

    const missingBatch: SanctionBatchDoc[] = [
      {
        id: 'inc-bad',
        ref: makeRef('incident_logs/inc-bad'),
        data: () => ({}),
      },
    ];
    expect(() => prepareSanctionUpdate(missingBatch, selection)).toThrow(
      'non-finite "breach_count"',
    );
  });
});

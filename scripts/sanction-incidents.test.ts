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

import {
  hasValidVotingFields,
  normalizeSelection,
  parseIncidentDoc,
  prepareSanctionUpdate,
  readFiniteNumber,
  sanitizeRationale,
  type Candidate,
  type SanctionSelection,
} from './sanction-incidents.js';

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
    system_dx: 'dx',
    incident_feed_summary: 'summary',
    share_quote: 'quote',
  };
}

describe('sanction-incidents helpers', () => {
  it('sanitizeRationale trims and caps length to 500 chars', () => {
    expect(sanitizeRationale('  hi  ')).toBe('hi');
    expect(sanitizeRationale('x'.repeat(600))).toHaveLength(500);
    expect(sanitizeRationale(42)).toBe('');
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
          system_dx: 'dx',
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
      system_dx: 'dx',
      incident_feed_summary: 'summary',
      share_quote: 'quote',
    });
  });

  it('parseIncidentDoc throws on missing required fields', () => {
    expect(() => parseIncidentDoc({ uid: 'u1' }, 'inc-2')).toThrow(
      '[sanction-incidents] incident_logs/inc-2 has invalid "legacy_infra_class"',
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

  it('readFiniteNumber returns finite numbers and falls back to zero for invalid values', () => {
    expect(readFiniteNumber({ a: 3 }, 'a')).toBe(3);
    expect(readFiniteNumber({ a: Number.NaN }, 'a')).toBe(0);
    expect(readFiniteNumber({ a: '3' }, 'a')).toBe(0);
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
  });

  it('prepareSanctionUpdate returns selected doc update payload with computed impact score', () => {
    const selection: SanctionSelection = {
      sanctioned_incident_id: 'inc-10',
      sanction_rationale: 'serious breach',
    };

    const { selectedDoc, updatePayload } = prepareSanctionUpdate(
      [
        {
          id: 'inc-10',
          ref: { path: 'incident_logs/inc-10' },
          data: () => ({ breach_count: 3, escalation_count: 2 }),
        },
      ],
      selection,
    );

    expect(selectedDoc.id).toBe('inc-10');
    expect(updatePayload).toEqual({
      sanctioned: true,
      sanction_count: 1,
      sanction_rationale: 'serious breach',
      impact_score: 17,
    });
  });

  it('prepareSanctionUpdate treats invalid counters as zero and throws if selected doc is absent', () => {
    const selection: SanctionSelection = {
      sanctioned_incident_id: 'inc-11',
      sanction_rationale: 'reason',
    };

    const update = prepareSanctionUpdate(
      [
        {
          id: 'inc-11',
          ref: { path: 'incident_logs/inc-11' },
          data: () => ({ breach_count: 'x', escalation_count: Number.NaN }),
        },
      ],
      selection,
    );

    expect(update.updatePayload.impact_score).toBe(5);

    expect(() =>
      prepareSanctionUpdate(
        [
          {
            id: 'inc-other',
            ref: { path: 'incident_logs/inc-other' },
            data: () => ({}),
          },
        ],
        selection,
      ),
    ).toThrow('Selected incident inc-11 is not in the candidate batch');
  });
});

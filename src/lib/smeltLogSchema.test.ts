import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import { parseSmeltLog, parseSmeltLogBatch } from './smeltLogSchema';

/**
 * `parseSmeltLog` is the single load-bearing schema boundary for
 * `incident_logs` docs. AGENTS.md flags it as strict — every field
 * required, no fallbacks, no legacy handling. These tests pin the
 * branch coverage so silently dropping a required field, or changing
 * a required field's type, surfaces as a failing test before the
 * app tries to render `undefined` in a card header.
 */

function makeTimestamp(ms = 1_700_000_000_000): Timestamp {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    isEqual: () => false,
    toJSON: () => ({ seconds: 0, nanoseconds: 0 }),
    valueOf: () => String(ms),
  } as unknown as Timestamp;
}

function makeValidRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    impact_score: 17,
    pixel_count: 42_000,
    incident_feed_summary: 'summary',
    color_1: '#ff0000',
    color_2: '#00ff00',
    color_3: '#0000ff',
    color_4: '#ffff00',
    color_5: '#00ffff',
    subject_box_ymin: 0,
    subject_box_xmin: 0,
    subject_box_ymax: 1000,
    subject_box_xmax: 1000,
    legacy_infra_class: 'Node',
    diagnosis: 'd',
    chromatic_profile: 'p',
    severity: 'HIGH',
    primary_contamination: 'c',
    contributing_factor: 'f',
    failure_origin: 'o',
    disposition: 'disp',
    archive_note: 'n',
    og_headline: 'h',
    share_quote: 'q',
    anon_handle: 'a',
    timestamp: makeTimestamp(),
    uid: 'u',
    breach_count: 1,
    escalation_count: 2,
    sanction_count: 0,
    sanctioned: false,
    sanction_rationale: null,
    ...overrides,
  };
}

const STRING_FIELDS = [
  'incident_feed_summary',
  'color_1',
  'color_2',
  'color_3',
  'color_4',
  'color_5',
  'legacy_infra_class',
  'diagnosis',
  'chromatic_profile',
  'severity',
  'primary_contamination',
  'contributing_factor',
  'failure_origin',
  'disposition',
  'archive_note',
  'og_headline',
  'share_quote',
  'anon_handle',
  'uid',
] as const;

const NUMBER_FIELDS = [
  'impact_score',
  'pixel_count',
  'subject_box_ymin',
  'subject_box_xmin',
  'subject_box_ymax',
  'subject_box_xmax',
  'breach_count',
  'escalation_count',
  'sanction_count',
] as const;

describe('parseSmeltLog', () => {
  describe('happy path', () => {
    it('returns a fully typed SmeltLog with the doc id embedded', () => {
      const parsed = parseSmeltLog('doc-1', makeValidRaw());
      expect(parsed.id).toBe('doc-1');
      expect(parsed.impact_score).toBe(17);
      expect(parsed.pixel_count).toBe(42_000);
      expect(parsed.incident_feed_summary).toBe('summary');
      expect(parsed.breach_count).toBe(1);
      expect(parsed.escalation_count).toBe(2);
      expect(parsed.sanction_count).toBe(0);
      expect(parsed.sanctioned).toBe(false);
      expect(parsed.sanction_rationale).toBeNull();
      // Timestamp is forwarded by reference — parseSmeltLog never clones it.
      expect(typeof parsed.timestamp.toDate).toBe('function');
    });

    it('accepts a non-null sanction_rationale string', () => {
      const parsed = parseSmeltLog('doc-2', makeValidRaw({ sanction_rationale: 'because' }));
      expect(parsed.sanction_rationale).toBe('because');
    });

    it('accepts a sanctioned=true boolean', () => {
      const parsed = parseSmeltLog('doc-3', makeValidRaw({ sanctioned: true }));
      expect(parsed.sanctioned).toBe(true);
    });

    it('preserves numeric zero without coercing to undefined', () => {
      const parsed = parseSmeltLog(
        'doc-4',
        makeValidRaw({ impact_score: 0, pixel_count: 0, subject_box_xmin: 0 }),
      );
      expect(parsed.impact_score).toBe(0);
      expect(parsed.pixel_count).toBe(0);
      expect(parsed.subject_box_xmin).toBe(0);
    });
  });

  describe('payload-shape rejection', () => {
    it.each([
      ['null', null],
      ['string', 'nope'],
      ['number', 42],
      ['boolean', true],
      ['undefined', undefined],
    ])('throws when raw is %s', (_label, raw) => {
      expect(() => parseSmeltLog('doc-x', raw)).toThrow(
        /incident_logs\/doc-x has invalid payload/,
      );
    });

    it('accepts arrays only because arrays are objects (parseable shape), but requires fields', () => {
      // An array hits `isObject` (typeof 'object' && not null) — it then
      // fails the first field check. This test pins that the array path
      // hits the per-field error, not the payload-shape error, so a
      // future switch to `Array.isArray` guarding can be a deliberate
      // change instead of a silent one.
      expect(() => parseSmeltLog('doc-arr', [])).toThrow(
        /incident_logs\/doc-arr has invalid "impact_score"/,
      );
    });
  });

  describe('string field validation', () => {
    it.each(STRING_FIELDS)('rejects missing "%s"', (field) => {
      const raw = makeValidRaw();
      delete raw[field];
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        `incident_logs/doc has invalid "${field}" (expected non-empty string)`,
      );
    });

    it.each(STRING_FIELDS)('rejects empty-string "%s" as missing', (field) => {
      const raw = makeValidRaw({ [field]: '' });
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        `incident_logs/doc has invalid "${field}"`,
      );
    });

    it.each(STRING_FIELDS)('rejects non-string "%s"', (field) => {
      const raw = makeValidRaw({ [field]: 42 });
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        `incident_logs/doc has invalid "${field}"`,
      );
    });
  });

  describe('number field validation', () => {
    it.each(NUMBER_FIELDS)('rejects missing "%s"', (field) => {
      const raw = makeValidRaw();
      delete raw[field];
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        `incident_logs/doc has invalid "${field}" (expected finite number)`,
      );
    });

    it.each(NUMBER_FIELDS)('rejects string "%s"', (field) => {
      const raw = makeValidRaw({ [field]: '7' });
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        `incident_logs/doc has invalid "${field}"`,
      );
    });

    it.each(NUMBER_FIELDS)('rejects NaN "%s"', (field) => {
      const raw = makeValidRaw({ [field]: Number.NaN });
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        `incident_logs/doc has invalid "${field}"`,
      );
    });

    it.each(NUMBER_FIELDS)('rejects Infinity "%s"', (field) => {
      const raw = makeValidRaw({ [field]: Number.POSITIVE_INFINITY });
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        `incident_logs/doc has invalid "${field}"`,
      );
    });

    it('accepts negative numbers (the schema does not bound counters)', () => {
      // parseSmeltLog only enforces "finite number" shape — negative counters
      // are not a schema concern at this layer because the server write path
      // and security rules handle counter invariants. This test pins that
      // negatives pass through so a future tightening here is a deliberate
      // change.
      const parsed = parseSmeltLog('doc', makeValidRaw({ breach_count: -1 }));
      expect(parsed.breach_count).toBe(-1);
    });
  });

  describe('boolean field validation', () => {
    it('rejects missing sanctioned', () => {
      const raw = makeValidRaw();
      delete raw.sanctioned;
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        /incident_logs\/doc has invalid "sanctioned" \(expected boolean\)/,
      );
    });

    it.each([
      ['string', 'true'],
      ['number', 1],
      ['null', null],
    ])('rejects %s sanctioned', (_label, value) => {
      expect(() => parseSmeltLog('doc', makeValidRaw({ sanctioned: value }))).toThrow(
        /incident_logs\/doc has invalid "sanctioned"/,
      );
    });
  });

  describe('nullable string sanction_rationale', () => {
    it('rejects missing key (undefined)', () => {
      const raw = makeValidRaw();
      delete raw.sanction_rationale;
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        /incident_logs\/doc has invalid "sanction_rationale" \(expected string\|null\)/,
      );
    });

    it('accepts the empty string (nullable variant does not check length)', () => {
      // Empty string is a valid shape for the nullable parser, unlike
      // `expectString` which rejects empty. Pinning this so the behaviour
      // is explicit for future readers.
      const parsed = parseSmeltLog('doc', makeValidRaw({ sanction_rationale: '' }));
      expect(parsed.sanction_rationale).toBe('');
    });

    it.each([
      ['number', 7],
      ['boolean', true],
      ['object', {}],
    ])('rejects %s sanction_rationale', (_label, value) => {
      expect(() =>
        parseSmeltLog('doc', makeValidRaw({ sanction_rationale: value })),
      ).toThrow(/incident_logs\/doc has invalid "sanction_rationale"/);
    });
  });

  describe('timestamp validation', () => {
    it('rejects missing timestamp', () => {
      const raw = makeValidRaw();
      delete raw.timestamp;
      expect(() => parseSmeltLog('doc', raw)).toThrow(
        /incident_logs\/doc has invalid "timestamp" \(expected Timestamp\)/,
      );
    });

    it('rejects a plain Date (no toMillis method)', () => {
      expect(() => parseSmeltLog('doc', makeValidRaw({ timestamp: new Date() }))).toThrow(
        /incident_logs\/doc has invalid "timestamp"/,
      );
    });

    it('rejects a partial object missing toMillis', () => {
      const partial = { toDate: () => new Date() } as unknown as Timestamp;
      expect(() => parseSmeltLog('doc', makeValidRaw({ timestamp: partial }))).toThrow(
        /incident_logs\/doc has invalid "timestamp"/,
      );
    });

    it('accepts any duck-typed object with toDate + toMillis', () => {
      const fake = {
        toDate: () => new Date(0),
        toMillis: () => 0,
      } as unknown as Timestamp;
      const parsed = parseSmeltLog('doc', makeValidRaw({ timestamp: fake }));
      expect(parsed.timestamp).toBe(fake);
    });
  });
});

function makeDoc(id: string, data: unknown) {
  return { id, data: () => data };
}

describe('parseSmeltLogBatch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns every valid entry and invalidCount 0 on a clean batch', () => {
    const docs = [
      makeDoc('a', makeValidRaw()),
      makeDoc('b', makeValidRaw({ impact_score: 5 })),
    ];
    const result = parseSmeltLogBatch(docs, { source: 'test' });
    expect(result.invalidCount).toBe(0);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('omits malformed entries without crashing the batch', () => {
    // The stream handler must survive one bad doc — otherwise a single
    // corrupt write could freeze the whole incidents feed.
    const docs = [
      makeDoc('good', makeValidRaw()),
      makeDoc('bad', { ...makeValidRaw(), impact_score: 'nope' }),
      makeDoc('also-good', makeValidRaw({ impact_score: 3 })),
    ];
    const result = parseSmeltLogBatch(docs, { source: 'test' });
    expect(result.invalidCount).toBe(1);
    expect(result.entries.map((e) => e.id)).toEqual(['good', 'also-good']);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('caps individual error logs at maxLoggedErrors and emits a summary line', () => {
    // 5 bad docs with maxLoggedErrors=2 → 2 per-doc logs + 1 summary = 3 calls.
    // The summary exists so an operator tailing stderr sees the spill volume
    // without getting spammed by 50 identical traces.
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeDoc(`bad-${i}`, { impact_score: 'nope' }),
    );
    const result = parseSmeltLogBatch(docs, { source: 'test', maxLoggedErrors: 2 });
    expect(result.invalidCount).toBe(5);
    expect(result.entries).toHaveLength(0);
    expect(console.error).toHaveBeenCalledTimes(3);
    const lastCall = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[2];
    expect(lastCall[0] as string).toContain('Skipped 3 additional malformed');
  });

  it('does not emit a summary line when invalid count equals maxLoggedErrors exactly', () => {
    const docs = Array.from({ length: 2 }, (_, i) =>
      makeDoc(`bad-${i}`, { impact_score: 'nope' }),
    );
    const result = parseSmeltLogBatch(docs, { source: 'test', maxLoggedErrors: 2 });
    expect(result.invalidCount).toBe(2);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('handles an empty input array', () => {
    expect(parseSmeltLogBatch([], { source: 'test' })).toEqual({
      entries: [],
      invalidCount: 0,
    });
    expect(console.error).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
/**
 * Unit tests for the sanction judging module. Mocks firebase-admin and
 * @google/genai so the suite runs without a Firestore emulator. The module
 * exports a `__resetSanctionSingletonsForTests` seam that clears the lazy
 * `_db` / `_ai` caches between tests — every test that touches them calls
 * it in `beforeEach`.
 *
 * Coverage goals:
 *   - Pure helpers (sanitizeRationale, parseIncidentDoc, normalizeSelection,
 *     requireNonNegativeCounter) — full branch coverage of error paths.
 *   - sweepStaleLeases — empty, non-empty, batch-commit shape.
 *   - claimBatch — transactional read, update shape, below-threshold early-exit.
 *   - judgeBatch — happy path, retry on empty, retry on invalid, exhaustion.
 *   - finalizeWinner — atomic batch shape, lease-clear fanout, invariant
 *     failure on corrupt counter.
 *   - runSanctionBatch — orchestration, no-op path, claim→judge→finalize,
 *     error rethrow for Cloud Functions retry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mock state ──────────────────────────────────────────────────────
// vi.hoisted runs before the module import, so the mocked firebase-admin
// and @google/genai modules can reference this state at load time.
const { firestoreMocks, generateContentMock, GoogleGenAIMock, TypeMock } = vi.hoisted(() => {
  const generateContent = vi.fn();

  // Timestamp stub: `fromMillis` wraps a millisecond value; `toMillis` is
  // the inverse. The real admin SDK's Timestamp has a richer API, but
  // `claimBatch`, `sweepStaleLeases`, and `finalizeWinner` only touch these
  // two methods via the query filter and lease write.
  class StubTimestamp {
    constructor(ms) {
      this._ms = ms;
    }
    toMillis() {
      return this._ms;
    }
    static fromMillis(ms) {
      return new StubTimestamp(ms);
    }
  }

  return {
    firestoreMocks: {
      Timestamp: StubTimestamp,
      FieldValue: { delete: vi.fn(() => '__FIELD_VALUE_DELETE__') },
      getFirestore: vi.fn(),
      initializeApp: vi.fn(),
      getApps: vi.fn(() => []),
    },
    generateContentMock: generateContent,
    GoogleGenAIMock: vi.fn(function GoogleGenAIStub() {
      this.models = { generateContent };
    }),
    TypeMock: { OBJECT: 'OBJECT', STRING: 'STRING' },
  };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: firestoreMocks.initializeApp,
  getApps: firestoreMocks.getApps,
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: firestoreMocks.FieldValue,
  Timestamp: firestoreMocks.Timestamp,
  getFirestore: firestoreMocks.getFirestore,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: GoogleGenAIMock,
  Type: TypeMock,
}));

// Imported AFTER vi.mock registrations so the module picks up the stubs.
const {
  MIN_BATCH,
  MAX_SELECTION_ATTEMPTS,
  sanitizeRationale,
  sanitizeReason,
  parseIncidentDoc,
  requireNonNegativeCounter,
  normalizeSelection,
  sweepStaleLeases,
  claimBatch,
  judgeBatch,
  finalizeWinner,
  finalizeNoWinner,
  finalizeBatch,
  runSanctionBatch,
  __resetSanctionSingletonsForTests,
} = await import('./sanction.js');

// ── Shared fixture builders ─────────────────────────────────────────────────

function makeCandidate(id) {
  return {
    incident_id: id,
    legacy_infra_class: 'Class',
    incident_feed_summary: 'Summary',
    share_quote: 'Quote',
    diagnosis: 'Diagnosis',
    severity: 'high',
    disposition: 'Disposition',
    primary_contamination: 'Contamination',
    contributing_factor: 'Factor',
    failure_origin: 'Origin',
    archive_note: 'Archive',
    chromatic_profile: 'Profile',
  };
}

function makeIncidentData(overrides = {}) {
  return {
    uid: 'uid-x',
    legacy_infra_class: 'Class',
    incident_feed_summary: 'Summary',
    share_quote: 'Quote',
    diagnosis: 'Diagnosis',
    severity: 'high',
    disposition: 'Disposition',
    primary_contamination: 'Contamination',
    contributing_factor: 'Factor',
    failure_origin: 'Origin',
    archive_note: 'Archive',
    chromatic_profile: 'Profile',
    breach_count: 1,
    escalation_count: 2,
    sanction_count: 0,
    sanctioned: false,
    sanction_rationale: null,
    evaluated: false,
    sanction_lease_at: null,
    ...overrides,
  };
}

function makeDocSnapshot(id, data) {
  return {
    id,
    ref: { path: `incident_logs/${id}`, __id: id },
    data: () => data,
  };
}

/**
 * Build a mock Firestore db handle with the exact surface sanction.js
 * touches: `collection(...).where(...).orderBy(...).limit(...)`,
 * `runTransaction`, and `batch()`. Returns the db plus references to the
 * inner mocks so tests can assert call counts, payload shapes, and ordering.
 */
function makeMockDb({
  claimQuerySize = 0,
  claimQueryDocs = [],
  sweepDocs = [],
  activeLeaseDocs = [],
} = {}) {
  const batchUpdates = [];
  const batchCommits = [];

  const batchObj = {
    update: vi.fn((ref, payload) => {
      batchUpdates.push({ ref, payload });
    }),
    commit: vi.fn(async () => {
      batchCommits.push(batchUpdates.slice());
    }),
  };

  const sweepSnap = {
    empty: sweepDocs.length === 0,
    size: sweepDocs.length,
    docs: sweepDocs,
  };
  const activeLeaseSnap = {
    empty: activeLeaseDocs.length === 0,
    size: activeLeaseDocs.length,
    docs: activeLeaseDocs,
  };

  // Three different query chains are needed: sweep (lease < cutoff),
  // active-lease probe (lease > epoch), and claim (evaluated=false). The
  // mock resolves by field + operator.
  const sweepQuery = { get: vi.fn(async () => sweepSnap) };
  const activeLeaseQuery = { get: vi.fn(async () => activeLeaseSnap) };
  const claimQuery = {
    get: vi.fn(async () => ({
      size: claimQuerySize,
      empty: claimQuerySize === 0,
      docs: claimQueryDocs,
    })),
  };

  const collectionHandle = {
    where: vi.fn((field, op, _value) => {
      if (field === 'sanction_lease_at') {
        if (op === '<') return sweepQuery;
        return {
          limit: vi.fn(() => activeLeaseQuery),
        };
      }
      // 'evaluated' query chain → claim path
      return {
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => claimQuery),
        })),
      };
    }),
  };

  const txUpdates = [];
  const db = {
    collection: vi.fn(() => collectionHandle),
    batch: vi.fn(() => batchObj),
    runTransaction: vi.fn(async (fn) => {
      const tx = {
        get: vi.fn(async () => ({
          size: claimQuerySize,
          empty: claimQuerySize === 0,
          docs: claimQueryDocs,
        })),
        update: vi.fn((ref, payload) => {
          txUpdates.push({ ref, payload });
        }),
      };
      return fn(tx);
    }),
  };

  return {
    db,
    batchObj,
    batchUpdates,
    batchCommits,
    txUpdates,
    claimQuery,
    sweepQuery,
    activeLeaseQuery,
    collectionHandle,
  };
}

// ── Helper: pure utilities ──────────────────────────────────────────────────

describe('sanitizeRationale', () => {
  it('trims, caps at 150 chars, and rejects non-strings', () => {
    expect(sanitizeRationale('  hi  ')).toBe('hi');
    expect(sanitizeRationale('x'.repeat(300))).toHaveLength(150);
    expect(sanitizeRationale('y'.repeat(150))).toHaveLength(150);
    expect(sanitizeRationale('   ')).toBe('');
    expect(sanitizeRationale(42)).toBe('');
    expect(sanitizeRationale(null)).toBe('');
    expect(sanitizeRationale(undefined)).toBe('');
  });
});

describe('sanitizeReason', () => {
  it('trims, caps at 500 chars, and rejects non-strings', () => {
    expect(sanitizeReason('  flat batch  ')).toBe('flat batch');
    expect(sanitizeReason('x'.repeat(600))).toHaveLength(500);
    expect(sanitizeReason('   ')).toBe('');
    expect(sanitizeReason(42)).toBe('');
    expect(sanitizeReason(null)).toBe('');
    expect(sanitizeReason(undefined)).toBe('');
  });
});

describe('parseIncidentDoc', () => {
  it('parses complete payload into the candidate shape', () => {
    const parsed = parseIncidentDoc(
      {
        uid: 'u1',
        legacy_infra_class: 'class',
        incident_feed_summary: 'summary',
        share_quote: 'quote',
        diagnosis: 'diag',
        severity: 'med',
        disposition: 'dispose',
        primary_contamination: 'contam',
        contributing_factor: 'factor',
        failure_origin: 'origin',
        archive_note: 'archive',
        chromatic_profile: 'profile',
      },
      'inc-1',
    );
    expect(parsed).toEqual({
      legacy_infra_class: 'class',
      incident_feed_summary: 'summary',
      share_quote: 'quote',
      diagnosis: 'diag',
      severity: 'med',
      disposition: 'dispose',
      primary_contamination: 'contam',
      contributing_factor: 'factor',
      failure_origin: 'origin',
      archive_note: 'archive',
      chromatic_profile: 'profile',
    });
    // uid is intentionally excluded — not relevant for judging
    expect(parsed).not.toHaveProperty('uid');
  });

  it('throws on missing required string field', () => {
    expect(() => parseIncidentDoc({ legacy_infra_class: 'x' }, 'inc-2')).toThrow(
      '[sanction] incident_logs/inc-2 has invalid "incident_feed_summary"',
    );
  });

  it('throws on non-object payloads', () => {
    expect(() => parseIncidentDoc(null, 'inc-null')).toThrow(
      '[sanction] incident_logs/inc-null has invalid payload',
    );
    expect(() => parseIncidentDoc('nope', 'inc-str')).toThrow(
      '[sanction] incident_logs/inc-str has invalid payload',
    );
    expect(() => parseIncidentDoc(42, 'inc-num')).toThrow(
      '[sanction] incident_logs/inc-num has invalid payload',
    );
  });
});

describe('requireNonNegativeCounter', () => {
  it('returns finite non-negative numbers and throws otherwise', () => {
    expect(requireNonNegativeCounter({ a: 0 }, 'a', 'inc')).toBe(0);
    expect(requireNonNegativeCounter({ a: 7 }, 'a', 'inc')).toBe(7);
    expect(() => requireNonNegativeCounter({}, 'a', 'inc-missing')).toThrow(
      'non-finite "a"',
    );
    expect(() => requireNonNegativeCounter({ a: 'x' }, 'a', 'inc-str')).toThrow('non-finite "a"');
    expect(() => requireNonNegativeCounter({ a: Number.NaN }, 'a', 'inc-nan')).toThrow(
      'non-finite "a"',
    );
    expect(() => requireNonNegativeCounter({ a: Number.POSITIVE_INFINITY }, 'a', 'inc-inf')).toThrow(
      'non-finite "a"',
    );
    expect(() => requireNonNegativeCounter({ a: -1 }, 'a', 'inc-neg')).toThrow('negative "a"');
  });
});

describe('normalizeSelection', () => {
  const candidates = [makeCandidate('inc-a'), makeCandidate('inc-b')];

  it('returns no-winner shape for null selection with non-empty reason', () => {
    expect(
      normalizeSelection(
        {
          sanctioned_incident_id: null,
          sanction_rationale: '',
          reason: '  No candidate clearly earned the sanction this round.  ',
        },
        candidates,
      ),
    ).toEqual({
      sanctioned_incident_id: null,
      sanction_rationale: '',
      reason: 'No candidate clearly earned the sanction this round.',
    });
  });

  it('rejects null selection with empty reason', () => {
    expect(
      () =>
        normalizeSelection(
          { sanctioned_incident_id: null, sanction_rationale: '', reason: '   ' },
          candidates,
        ),
    ).toThrow('returned no winner without a reason');
  });

  it('drops sanction_rationale on null winner and keeps reason', () => {
    expect(
      normalizeSelection(
        {
          sanctioned_incident_id: null,
          sanction_rationale: 'this should be ignored',
          reason: 'flat batch',
        },
        candidates,
      ),
    ).toEqual({
      sanctioned_incident_id: null,
      sanction_rationale: '',
      reason: 'flat batch',
    });
  });

  it('accepts valid winner, requires rationale, and clears reason', () => {
    expect(
      normalizeSelection(
        {
          sanctioned_incident_id: 'inc-a',
          sanction_rationale: '  because  ',
          reason: 'should be ignored on winner',
        },
        candidates,
      ),
    ).toEqual({
      sanctioned_incident_id: 'inc-a',
      sanction_rationale: 'because',
      reason: '',
    });
  });

  it('rejects missing id, unknown candidate, and missing rationale', () => {
    expect(() => normalizeSelection({}, candidates)).toThrow(
      'must return "sanctioned_incident_id" as a non-empty string or null',
    );
    expect(() =>
      normalizeSelection({ sanctioned_incident_id: 'inc-z', sanction_rationale: 'r' }, candidates),
    ).toThrow('selected non-candidate incident "inc-z"');
    expect(() =>
      normalizeSelection({ sanctioned_incident_id: 'inc-a', sanction_rationale: '  ' }, candidates),
    ).toThrow('without a rationale');
    expect(() =>
      normalizeSelection({ sanctioned_incident_id: 42, sanction_rationale: 'r' }, candidates),
    ).toThrow('must return "sanctioned_incident_id" as a non-empty string or null');
  });
});

// ── Sanction phases ─────────────────────────────────────────────────────────

describe('sweepStaleLeases', () => {
  beforeEach(() => {
    __resetSanctionSingletonsForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns recoveredCount 0 when no stale leases exist', async () => {
    const { db, sweepQuery, batchObj } = makeMockDb({ sweepDocs: [] });
    const result = await sweepStaleLeases({ now: 10_000_000, db });
    expect(result).toEqual({ recoveredCount: 0 });
    expect(sweepQuery.get).toHaveBeenCalledOnce();
    // No batch commit on empty sweep — the empty-early-exit branch must
    // not instantiate a batch write for nothing.
    expect(batchObj.commit).not.toHaveBeenCalled();
  });

  it('clears lease fields on every stale doc in one batch', async () => {
    const staleDocs = [
      makeDocSnapshot('stale-1', {}),
      makeDocSnapshot('stale-2', {}),
    ];
    const { db, batchObj, batchUpdates } = makeMockDb({ sweepDocs: staleDocs });
    const result = await sweepStaleLeases({ now: 10_000_000, db });
    expect(result).toEqual({ recoveredCount: 2 });
    expect(batchObj.commit).toHaveBeenCalledOnce();
    expect(batchUpdates).toHaveLength(2);
    for (const { payload } of batchUpdates) {
      expect(payload).toEqual({ evaluated: false, sanction_lease_at: null });
    }
  });
});

describe('claimBatch', () => {
  beforeEach(() => {
    __resetSanctionSingletonsForTests();
  });

  it('returns an empty array when fewer than MIN_BATCH unevaluated docs exist', async () => {
    const { db, txUpdates } = makeMockDb({
      claimQuerySize: MIN_BATCH - 1,
      claimQueryDocs: Array.from({ length: MIN_BATCH - 1 }, (_, i) =>
        makeDocSnapshot(`inc-${i}`, makeIncidentData()),
      ),
    });
    const claimed = await claimBatch({ now: 10_000_000, db });
    expect(claimed).toEqual([]);
    // No updates issued when the threshold is not met — claim is all-or-nothing.
    expect(txUpdates).toHaveLength(0);
  });

  it('marks every claimed doc evaluated=true + lease=now and returns pre-claim data', async () => {
    const docs = Array.from({ length: MIN_BATCH }, (_, i) =>
      makeDocSnapshot(`inc-${i}`, makeIncidentData({ breach_count: i })),
    );
    const { db, txUpdates } = makeMockDb({
      claimQuerySize: MIN_BATCH,
      claimQueryDocs: docs,
    });
    const claimed = await claimBatch({ now: 10_000_000, db });
    expect(claimed).toHaveLength(MIN_BATCH);
    expect(txUpdates).toHaveLength(MIN_BATCH);
    for (const { payload } of txUpdates) {
      expect(payload.evaluated).toBe(true);
      // Timestamp stub exposes `toMillis` for equality checking.
      expect(payload.sanction_lease_at.toMillis()).toBe(10_000_000);
    }
    // The returned snapshots expose the pre-claim data (breach_count values 0-4),
    // which finalizeWinner later re-reads to recompute impact_score.
    expect(claimed.map((c) => c.data.breach_count)).toEqual([0, 1, 2, 3, 4]);
    // ref identity: each claimed entry forwards the original doc ref so
    // finalizeWinner writes to the right document.
    claimed.forEach((c, i) => {
      expect(c.ref).toBe(docs[i].ref);
      expect(c.id).toBe(`inc-${i}`);
    });
  });
});

describe('judgeBatch', () => {
  beforeEach(() => {
    __resetSanctionSingletonsForTests();
    generateContentMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns normalized selection on first successful call', async () => {
    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        sanctioned_incident_id: 'c2',
        sanction_rationale: 'reason',
        reason: '',
      }),
    });
    const aiClient = { models: { generateContent: generateContentMock } };
    const result = await judgeBatch(candidates, { aiClient });
    expect(result).toEqual({
      sanctioned_incident_id: 'c2',
      sanction_rationale: 'reason',
      reason: '',
    });
    expect(generateContentMock).toHaveBeenCalledOnce();
  });

  it('passes through no-winner selections', async () => {
    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        sanctioned_incident_id: null,
        sanction_rationale: '',
        reason: 'flat batch',
      }),
    });
    const aiClient = { models: { generateContent: generateContentMock } };
    const result = await judgeBatch(candidates, { aiClient });
    expect(result).toEqual({
      sanctioned_incident_id: null,
      sanction_rationale: '',
      reason: 'flat batch',
    });
    expect(generateContentMock).toHaveBeenCalledOnce();
  });

  it('retries on empty text and succeeds on second attempt', async () => {
    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    generateContentMock
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({
        text: JSON.stringify({ sanctioned_incident_id: 'c1', sanction_rationale: 'ok', reason: '' }),
      });
    const aiClient = { models: { generateContent: generateContentMock } };
    const result = await judgeBatch(candidates, { aiClient });
    expect(result.sanctioned_incident_id).toBe('c1');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('throws after MAX_SELECTION_ATTEMPTS of invalid responses', async () => {
    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    generateContentMock
      .mockResolvedValueOnce({ text: '{}' })
      .mockResolvedValueOnce({
        // Unknown candidate id — normalizeSelection rejects.
        text: JSON.stringify({ sanctioned_incident_id: 'c99', sanction_rationale: 'ok' }),
      });
    const aiClient = { models: { generateContent: generateContentMock } };
    await expect(judgeBatch(candidates, { aiClient })).rejects.toThrow(
      `Gemini failed to produce a valid selection after ${MAX_SELECTION_ATTEMPTS}`,
    );
    expect(generateContentMock).toHaveBeenCalledTimes(MAX_SELECTION_ATTEMPTS);
  });

  it('retries on generateContent throws and surfaces the final error', async () => {
    const candidates = [makeCandidate('c1')];
    generateContentMock
      .mockRejectedValueOnce(new Error('rpc unavailable'))
      .mockRejectedValueOnce(new Error('rpc still unavailable'));
    const aiClient = { models: { generateContent: generateContentMock } };
    await expect(judgeBatch(candidates, { aiClient })).rejects.toThrow('rpc still unavailable');
    expect(generateContentMock).toHaveBeenCalledTimes(MAX_SELECTION_ATTEMPTS);
  });
});

describe('finalizeWinner', () => {
  beforeEach(() => {
    __resetSanctionSingletonsForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes winner fields and clears leases on all losers in one batch', async () => {
    const winnerData = makeIncidentData({ breach_count: 3, escalation_count: 2 });
    const batchDocs = [
      { id: 'inc-1', ref: { path: 'incident_logs/inc-1' }, data: makeIncidentData() },
      { id: 'inc-2', ref: { path: 'incident_logs/inc-2' }, data: winnerData },
      { id: 'inc-3', ref: { path: 'incident_logs/inc-3' }, data: makeIncidentData() },
      { id: 'inc-4', ref: { path: 'incident_logs/inc-4' }, data: makeIncidentData() },
      { id: 'inc-5', ref: { path: 'incident_logs/inc-5' }, data: makeIncidentData() },
    ];
    const selection = { sanctioned_incident_id: 'inc-2', sanction_rationale: 'reason' };
    const { db, batchObj, batchUpdates } = makeMockDb();

    const result = await finalizeWinner({ batchDocs, selection, db });

    // impact_score = 5*1 + 3*2 + 2*3 = 17
    expect(result).toEqual({ winnerId: 'inc-2', impactScore: 17, path: 'winner' });
    expect(batchObj.commit).toHaveBeenCalledOnce();
    expect(batchUpdates).toHaveLength(5);

    const winnerUpdate = batchUpdates.find((u) => u.ref.path === 'incident_logs/inc-2');
    expect(winnerUpdate.payload).toEqual({
      sanctioned: true,
      sanction_count: 1,
      sanction_rationale: 'reason',
      impact_score: 17,
      sanction_lease_at: null,
    });

    const loserUpdates = batchUpdates.filter((u) => u.ref.path !== 'incident_logs/inc-2');
    expect(loserUpdates).toHaveLength(4);
    for (const u of loserUpdates) {
      expect(u.payload).toEqual({ sanction_lease_at: null });
    }
  });

  it('throws when the selected incident is absent from the batch', async () => {
    const batchDocs = [
      { id: 'inc-1', ref: { path: 'incident_logs/inc-1' }, data: makeIncidentData() },
    ];
    const selection = { sanctioned_incident_id: 'inc-99', sanction_rationale: 'r' };
    const { db } = makeMockDb();
    await expect(finalizeWinner({ batchDocs, selection, db })).rejects.toThrow(
      'Selected incident inc-99 is not in the batch',
    );
  });

  it('refuses to write when the winner has a corrupt counter', async () => {
    const winnerData = makeIncidentData({ breach_count: Number.NaN, escalation_count: 0 });
    const batchDocs = [
      { id: 'inc-bad', ref: { path: 'incident_logs/inc-bad' }, data: winnerData },
    ];
    const selection = { sanctioned_incident_id: 'inc-bad', sanction_rationale: 'r' };
    const { db } = makeMockDb();
    await expect(finalizeWinner({ batchDocs, selection, db })).rejects.toThrow(
      'non-finite "breach_count"',
    );
  });
});

describe('finalizeNoWinner / finalizeBatch', () => {
  beforeEach(() => {
    __resetSanctionSingletonsForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears only leases on every doc for no-winner batches', async () => {
    const batchDocs = Array.from({ length: MIN_BATCH }, (_, i) => ({
      id: `inc-${i + 1}`,
      ref: { path: `incident_logs/inc-${i + 1}` },
      data: makeIncidentData(),
    }));
    const selection = {
      sanctioned_incident_id: null,
      sanction_rationale: '',
      reason: 'flat batch',
    };
    const { db, batchObj, batchUpdates } = makeMockDb();

    const result = await finalizeNoWinner({ batchDocs, selection, db });

    expect(result).toEqual({ winnerId: null, impactScore: null, path: 'no-winner' });
    expect(batchObj.commit).toHaveBeenCalledOnce();
    expect(batchUpdates).toHaveLength(MIN_BATCH);
    for (const update of batchUpdates) {
      expect(update.payload).toEqual({ sanction_lease_at: null });
    }
  });

  it('dispatches to no-winner path when selection id is null', async () => {
    const batchDocs = Array.from({ length: MIN_BATCH }, (_, i) => ({
      id: `inc-${i + 1}`,
      ref: { path: `incident_logs/inc-${i + 1}` },
      data: makeIncidentData(),
    }));
    const selection = {
      sanctioned_incident_id: null,
      sanction_rationale: '',
      reason: 'flat batch',
    };
    const { db, batchObj, batchUpdates } = makeMockDb();

    const result = await finalizeBatch({ batchDocs, selection, db });

    expect(result.path).toBe('no-winner');
    expect(batchObj.commit).toHaveBeenCalledOnce();
    for (const update of batchUpdates) {
      expect(update.payload).toEqual({ sanction_lease_at: null });
    }
  });
});

describe('runSanctionBatch', () => {
  beforeEach(() => {
    __resetSanctionSingletonsForTests();
    generateContentMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns no-op when fewer than MIN_BATCH unevaluated docs', async () => {
    const { db } = makeMockDb({
      claimQuerySize: MIN_BATCH - 1,
      claimQueryDocs: Array.from({ length: MIN_BATCH - 1 }, (_, i) =>
        makeDocSnapshot(`inc-${i}`, makeIncidentData()),
      ),
    });
    const aiClient = { models: { generateContent: generateContentMock } };
    const result = await runSanctionBatch({ aiClient, db });
    expect(result).toEqual({ status: 'no-op' });
    // Gemini must NOT be called when the batch is short — no-op is the
    // silent, wait-for-more-uploads branch.
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('throws on short batch when active leases still exist', async () => {
    const { db, activeLeaseQuery } = makeMockDb({
      claimQuerySize: MIN_BATCH - 1,
      claimQueryDocs: Array.from({ length: MIN_BATCH - 1 }, (_, i) =>
        makeDocSnapshot(`inc-${i}`, makeIncidentData()),
      ),
      activeLeaseDocs: [makeDocSnapshot('leased-1', makeIncidentData({ evaluated: true }))],
    });
    const aiClient = { models: { generateContent: generateContentMock } };

    await expect(runSanctionBatch({ aiClient, db })).rejects.toThrow(
      'active leases still exist',
    );
    expect(activeLeaseQuery.get).toHaveBeenCalledOnce();
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('completes sweep → claim → judge → finalize on a full batch', async () => {
    const claimDocs = Array.from({ length: MIN_BATCH }, (_, i) =>
      makeDocSnapshot(`inc-${i + 1}`, makeIncidentData({ breach_count: 1, escalation_count: 1 })),
    );
    const { db, batchCommits } = makeMockDb({
      claimQuerySize: MIN_BATCH,
      claimQueryDocs: claimDocs,
      sweepDocs: [],
    });
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        sanctioned_incident_id: 'inc-3',
        sanction_rationale: 'stood out',
        reason: '',
      }),
    });
    const aiClient = { models: { generateContent: generateContentMock } };

    const result = await runSanctionBatch({ aiClient, db });

    // impact_score = 5*1 + 3*1 + 2*1 = 10
    expect(result).toEqual({
      status: 'completed',
      winnerId: 'inc-3',
      impactScore: 10,
      path: 'winner',
    });
    expect(generateContentMock).toHaveBeenCalledOnce();
    // One batch commit for the finalize step — sweep short-circuited on
    // empty, and claim uses a transaction.
    expect(batchCommits).toHaveLength(1);
  });

  it('rethrows when judge fails so Cloud Functions v2 retry kicks in', async () => {
    const claimDocs = Array.from({ length: MIN_BATCH }, (_, i) =>
      makeDocSnapshot(`inc-${i + 1}`, makeIncidentData()),
    );
    const { db } = makeMockDb({
      claimQuerySize: MIN_BATCH,
      claimQueryDocs: claimDocs,
    });
    generateContentMock
      .mockResolvedValueOnce({ text: '{}' })
      .mockResolvedValueOnce({ text: '{}' });
    const aiClient = { models: { generateContent: generateContentMock } };

    await expect(runSanctionBatch({ aiClient, db })).rejects.toThrow(
      'Gemini failed to produce a valid selection',
    );
  });

  it('completes with no-winner path when judge returns null winner', async () => {
    const claimDocs = Array.from({ length: MIN_BATCH }, (_, i) =>
      makeDocSnapshot(`inc-${i + 1}`, makeIncidentData()),
    );
    const { db, batchCommits, batchUpdates } = makeMockDb({
      claimQuerySize: MIN_BATCH,
      claimQueryDocs: claimDocs,
      sweepDocs: [],
    });
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        sanctioned_incident_id: null,
        sanction_rationale: '',
        reason: 'flat batch',
      }),
    });
    const aiClient = { models: { generateContent: generateContentMock } };

    const result = await runSanctionBatch({ aiClient, db });

    expect(result).toEqual({
      status: 'completed',
      winnerId: null,
      impactScore: null,
      path: 'no-winner',
    });
    expect(batchCommits).toHaveLength(1);
    for (const { payload } of batchUpdates) {
      expect(payload).toEqual({ sanction_lease_at: null });
    }
  });
});

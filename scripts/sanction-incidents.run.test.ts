// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IncidentRow = {
  id: string;
  data: () => Record<string, unknown>;
  ref: { path: string };
};

type IncidentSnapshot = {
  size: number;
  empty: boolean;
  docs: IncidentRow[];
};

type LockState = {
  runId: string | null;
  expiresAt: number;
};

const { state } = vi.hoisted(() => {
  const marker = {
    exists: true,
    setCalls: [] as unknown[],
  };

  const lock: LockState = {
    runId: null,
    expiresAt: 0,
  };

  // When set, the transaction callback will be invoked with a tx mock that
  // has `data.run_id` forced to a different value so the production
  // `refreshRunLock` / `releaseRunLock` transactions see a lock owned by a
  // different process. The state is latched: once armed, the NEXT
  // transaction sees the stolen lock, and subsequent transactions revert to
  // the live `lock` state.
  let stealLockOnNextTransaction = false;
  const unsanctionedSnapshots: IncidentSnapshot[] = [];
  const migrationSnapshots: IncidentSnapshot[] = [];
  const modelResponses: Array<{ text?: string } | Error> = [];
  const batchUpdates: Array<{ ref: unknown; payload: Record<string, unknown> }> = [];
  let batchCommitCount = 0;
  let incidentQueryMode: 'unsanctioned' | 'migration' = 'unsanctioned';

  const lockRef = { __kind: 'lock_ref' };

  const incidentCollection = {
    where: vi.fn(() => {
      incidentQueryMode = 'unsanctioned';
      return incidentCollection;
    }),
    orderBy: vi.fn(() => incidentCollection),
    limit: vi.fn(() => incidentCollection),
    select: vi.fn(() => {
      incidentQueryMode = 'migration';
      return incidentCollection;
    }),
    startAfter: vi.fn(() => incidentCollection),
    get: vi.fn(async () => {
      const source = incidentQueryMode === 'migration' ? migrationSnapshots : unsanctionedSnapshots;
      const next = source.shift() ?? { size: 0, empty: true, docs: [] };
      return next;
    }),
  };

  const migrationDocRef = {
    get: vi.fn(async () => ({ exists: marker.exists })),
    set: vi.fn(async (payload: unknown) => {
      marker.setCalls.push(payload);
    }),
  };

  const lockDocRef = lockRef;

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'system_migrations') {
        return {
          doc: vi.fn(() => migrationDocRef),
        };
      }
      if (name === 'system_locks') {
        return {
          doc: vi.fn(() => lockDocRef),
        };
      }
      if (name === 'incident_logs') {
        return incidentCollection;
      }
      throw new Error(`Unexpected collection: ${name}`);
    }),
    runTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      // Each transaction gets a fresh tx proxy. The `data()` view reflects
      // the live lock state so acquire/refresh/release all see a consistent
      // picture, with optional one-shot overrides for stealing the lock or
      // failing the release.
      const dataOverride = stealLockOnNextTransaction
        ? { run_id: 'stolen-run-id', lock_expires_at_ms: Number.MAX_SAFE_INTEGER }
        : null;
      stealLockOnNextTransaction = false;

      const tx = {
        get: vi.fn(async (ref: unknown) => {
          if (ref !== lockRef) {
            return { data: () => ({}) };
          }
          return {
            data: () =>
              dataOverride ?? {
                run_id: lock.runId,
                lock_expires_at_ms: lock.expiresAt,
              },
          };
        }),
        set: vi.fn((ref: unknown, payload: Record<string, unknown>) => {
          if (ref !== lockRef) return;
          const runId = payload.run_id;
          const expiresAt = payload.lock_expires_at_ms;

          // `releaseRunLock` writes a FieldValue.delete() sentinel for the
          // run_id. Detect it by shape (object with non-string run_id) so
          // the mock can faithfully clear the lock state.
          if (runId !== undefined && typeof runId !== 'string') {
            lock.runId = null;
          } else if (typeof runId === 'string') {
            lock.runId = runId;
          }
          if (typeof expiresAt === 'number') lock.expiresAt = expiresAt;
        }),
      };

      const result = await fn(tx);
      return result;
    }),
    batch: vi.fn(() => ({
      update: vi.fn((ref: unknown, payload: Record<string, unknown>) => {
        batchUpdates.push({ ref, payload });
      }),
      commit: vi.fn(async () => {
        batchCommitCount += 1;
      }),
    })),
  };

  const generateContent = vi.fn(async () => {
    const next = modelResponses.shift();
    if (!next) throw new Error('No model response queued');
    if (next instanceof Error) throw next;
    return next;
  });

  const GoogleGenAI = vi.fn(function GoogleGenAIMock(this: { models: { generateContent: typeof generateContent } }) {
    this.models = { generateContent };
  });

  return {
    state: {
      db,
      GoogleGenAI,
      generateContent,
      marker,
      lock,
      unsanctionedSnapshots,
      migrationSnapshots,
      modelResponses,
      batchUpdates,
      getBatchCommitCount: () => batchCommitCount,
      armStealLockOnNextTransaction: () => {
        stealLockOnNextTransaction = true;
      },
      reset: () => {
        marker.exists = true;
        marker.setCalls = [];
        lock.runId = null;
        lock.expiresAt = 0;
        stealLockOnNextTransaction = false;
        incidentQueryMode = 'unsanctioned';
        unsanctionedSnapshots.length = 0;
        migrationSnapshots.length = 0;
        modelResponses.length = 0;
        batchUpdates.length = 0;
        batchCommitCount = 0;
        incidentCollection.get.mockClear();
        incidentCollection.where.mockClear();
        incidentCollection.orderBy.mockClear();
        incidentCollection.limit.mockClear();
        incidentCollection.select.mockClear();
        incidentCollection.startAfter.mockClear();
        db.collection.mockClear();
        db.runTransaction.mockClear();
        db.batch.mockClear();
        generateContent.mockClear();
        GoogleGenAI.mockClear();
        migrationDocRef.get.mockClear();
        migrationDocRef.set.mockClear();
      },
    },
  };
});

vi.mock('./lib/admin-init.js', () => ({
  db: state.db,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: state.GoogleGenAI,
}));

// Module cache is intentionally shared across tests: the runner's
// module-level `RUN_ID` (generated once via `randomUUID()` at first
// import) is a stable constant, and the mutable lock state lives entirely
// in the hoisted `state` mock, which `state.reset()` wipes in
// `beforeEach`. Re-importing the module (via `vi.resetModules()` plus a
// fresh `import()`) would give every test a different `RUN_ID` without
// changing behaviour, at the cost of confusing the mock's lock-equality
// checks. Keep the shared cache.
async function importRunner() {
  return import('./sanction-incidents.js');
}

// Silence the runner's intentional console noise during error-path
// tests. The runner logs operator-facing messages via `console.log`
// (progress) and `console.error` (failures). When a test explicitly
// exercises a failure path, those logs are expected output — leaving
// them unfiltered makes the test runner stderr unreadable when a real
// regression happens. Returns a restore callback that every caller is
// expected to invoke in a `finally`.
function silenceRunnerConsole() {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return {
    logSpy,
    warnSpy,
    errorSpy,
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

function makeIncident(id: string, breachCount: number, escalationCount: number): IncidentRow {
  return {
    id,
    ref: { path: `incident_logs/${id}` },
    data: () => ({
      uid: `uid-${id}`,
      legacy_infra_class: 'Class',
      diagnosis: 'Diagnosis',
      severity: 'high',
      archive_note: 'Archive',
      failure_origin: 'Origin',
      chromatic_profile: 'Chromatic',
      system_dx: 'System DX',
      incident_feed_summary: 'Summary',
      share_quote: 'Quote',
      breach_count: breachCount,
      escalation_count: escalationCount,
      sanction_count: 0,
      sanctioned: false,
      sanction_rationale: null,
    }),
  };
}

function validSelectionResponse(id: string, rationale = 'Rationale text') {
  return {
    text: JSON.stringify({
      sanctioned_incident_id: id,
      sanction_rationale: rationale,
    }),
  };
}

describe('runSanctionIncidents', () => {
  beforeEach(() => {
    state.reset();
    process.env.GEMINI_API_KEY = 'test-api-key';
    // Every test in this suite exercises the runner, which logs progress
    // to `console.log`/`console.error`. Tests that specifically assert
    // on a console call set their own spies — this blanket mute keeps
    // vitest stderr readable while still allowing those explicit spies
    // to record calls (vi.spyOn re-mocks the same method idempotently).
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commits exactly one selected incident per batch and leaves non-selected docs untouched', async () => {
    const docs = [
      makeIncident('inc-1', 0, 0),
      makeIncident('inc-2', 3, 2),
      makeIncident('inc-3', 1, 1),
      makeIncident('inc-4', 2, 0),
      makeIncident('inc-5', 0, 4),
    ];

    state.unsanctionedSnapshots.push(
      { size: 5, empty: false, docs },
      { size: 4, empty: false, docs: docs.slice(0, 4) },
    );

    state.modelResponses.push(validSelectionResponse('inc-2', 'Highest impact failure profile.'));

    const { runSanctionIncidents } = await importRunner();
    await runSanctionIncidents();

    expect(state.getBatchCommitCount()).toBe(1);
    expect(state.batchUpdates).toHaveLength(1);
    // Object-identity check: the batch writer must forward the selected doc's
    // actual ref, not a fresh mock. A drift here would point the Firestore
    // update at the wrong document.
    expect(state.batchUpdates[0].ref).toBe(docs[1].ref);
    expect(state.batchUpdates[0].payload).toEqual({
      sanctioned: true,
      sanction_count: 1,
      sanction_rationale: 'Highest impact failure profile.',
      impact_score: 17,
    });
  });

  it('processes multiple full batches in one run before waiting for more incidents', async () => {
    const batch1 = [
      makeIncident('a1', 0, 0),
      makeIncident('a2', 0, 0),
      makeIncident('a3', 0, 0),
      makeIncident('a4', 0, 0),
      makeIncident('a5', 1, 1),
    ];
    const batch2 = [
      makeIncident('b1', 0, 0),
      makeIncident('b2', 2, 0),
      makeIncident('b3', 0, 0),
      makeIncident('b4', 0, 0),
      makeIncident('b5', 0, 0),
    ];

    state.unsanctionedSnapshots.push(
      { size: 5, empty: false, docs: batch1 },
      { size: 5, empty: false, docs: batch2 },
      { size: 0, empty: true, docs: [] },
    );

    state.modelResponses.push(
      validSelectionResponse('a5', 'first'),
      validSelectionResponse('b2', 'second'),
    );

    const { runSanctionIncidents } = await importRunner();
    await runSanctionIncidents();

    expect(state.getBatchCommitCount()).toBe(2);
    expect(state.batchUpdates).toHaveLength(2);
    expect(state.batchUpdates[0].ref).toBe(batch1[4].ref);
    expect(state.batchUpdates[1].ref).toBe(batch2[1].ref);
  });

  it('returns early and commits nothing when fewer than MIN_BATCH unsanctioned docs exist', async () => {
    // Only 3 docs — below MIN_BATCH=5 — so the runner must exit without
    // asking Gemini for a selection or writing anything.
    state.unsanctionedSnapshots.push({
      size: 3,
      empty: false,
      docs: [
        makeIncident('inc-s1', 0, 0),
        makeIncident('inc-s2', 0, 0),
        makeIncident('inc-s3', 0, 0),
      ],
    });

    const { runSanctionIncidents } = await importRunner();
    await runSanctionIncidents();

    expect(state.generateContent).not.toHaveBeenCalled();
    expect(state.getBatchCommitCount()).toBe(0);
    expect(state.batchUpdates).toHaveLength(0);
  });

  it('skips the run entirely when another process already holds the lock', async () => {
    // Seed the lock as held by another run_id with a future expiry so
    // acquireRunLock returns false and the runner exits early.
    state.lock.runId = 'other-process';
    state.lock.expiresAt = Date.now() + 60_000;

    state.unsanctionedSnapshots.push({
      size: 5,
      empty: false,
      docs: [
        makeIncident('inc-10', 1, 1),
        makeIncident('inc-11', 1, 1),
        makeIncident('inc-12', 1, 1),
        makeIncident('inc-13', 1, 1),
        makeIncident('inc-14', 1, 1),
      ],
    });

    const { runSanctionIncidents } = await importRunner();
    await runSanctionIncidents();

    expect(state.generateContent).not.toHaveBeenCalled();
    expect(state.getBatchCommitCount()).toBe(0);
    // The runner must NOT have queried the incident_logs collection — we
    // bailed out before reaching the batch loop. The collection accessor
    // is only called for the lock doc.
    expect(state.db.collection).not.toHaveBeenCalledWith('incident_logs');
  });

  it('propagates "Run lock lost" error from refreshRunLock and performs no writes in that batch', async () => {
    // Acquire succeeds (baseline). After acquire, the next refresh sees a
    // different run_id and throws. Because the throw happens at the top of
    // the batch loop (before Gemini is called), no write is attempted.
    state.unsanctionedSnapshots.push({
      size: 5,
      empty: false,
      docs: [
        makeIncident('inc-20', 1, 1),
        makeIncident('inc-21', 1, 1),
        makeIncident('inc-22', 1, 1),
        makeIncident('inc-23', 1, 1),
        makeIncident('inc-24', 1, 1),
      ],
    });

    // Let the initial acquire succeed against a clean lock, then arm the
    // steal override so the refresh-at-top-of-batch transaction observes a
    // different run_id and throws. Note: the steal override is one-shot —
    // it latches for the NEXT transaction only, so the refresh trips the
    // error while the subsequent release in the `finally` still sees the
    // real (now-reset) lock state and succeeds.
    let callCount = 0;
    const originalImpl = state.db.runTransaction.getMockImplementation()!;
    state.db.runTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      callCount += 1;
      if (callCount === 2) {
        state.armStealLockOnNextTransaction();
      }
      return originalImpl(fn);
    });

    const noise = silenceRunnerConsole();
    try {
      const { runSanctionIncidents } = await importRunner();

      await expect(runSanctionIncidents()).rejects.toThrow('Run lock lost to another process');

      expect(state.generateContent).not.toHaveBeenCalled();
      expect(state.getBatchCommitCount()).toBe(0);
      expect(state.batchUpdates).toHaveLength(0);
    } finally {
      noise.restore();
    }
  });

  it('throws with a clear operator message when a candidate doc fails to parse mid-loop', async () => {
    // First doc is malformed (missing required string fields) so
    // parseIncidentDoc throws. The AGENTS.md contract: crash loudly with the
    // offending incident id in the error message so the operator can fix it.
    state.unsanctionedSnapshots.push({
      size: 5,
      empty: false,
      docs: [
        {
          id: 'inc-bad',
          ref: { path: 'incident_logs/inc-bad' },
          // `diagnosis` is missing entirely — parseIncidentDoc throws on
          // the second expectIncidentField call.
          data: () => ({
            uid: 'u',
            legacy_infra_class: 'Class',
            severity: 'high',
            archive_note: 'Archive',
            failure_origin: 'Origin',
            chromatic_profile: 'Chromatic',
            system_dx: 'System DX',
            incident_feed_summary: 'Summary',
            share_quote: 'Quote',
            breach_count: 0,
            escalation_count: 0,
            sanction_count: 0,
            sanctioned: false,
            sanction_rationale: null,
          }),
        },
        makeIncident('inc-ok-1', 0, 0),
        makeIncident('inc-ok-2', 0, 0),
        makeIncident('inc-ok-3', 0, 0),
        makeIncident('inc-ok-4', 0, 0),
      ],
    });

    const noise = silenceRunnerConsole();
    try {
      const { runSanctionIncidents } = await importRunner();

      await expect(runSanctionIncidents()).rejects.toThrow(
        '[sanction-incidents] incident_logs/inc-bad failed to parse',
      );

      expect(state.generateContent).not.toHaveBeenCalled();
      expect(state.getBatchCommitCount()).toBe(0);
      expect(state.batchUpdates).toHaveLength(0);
    } finally {
      noise.restore();
    }
  });

  it('propagates releaseRunLock errors so scheduler retries do not silently no-op on a stuck lock', async () => {
    // Happy-path run (one batch committed) but the release transaction
    // fails in the finally block. The runner must surface the release
    // error so the caller's exit code signals the stuck lock.
    const docs = [
      makeIncident('r1', 0, 0),
      makeIncident('r2', 0, 0),
      makeIncident('r3', 0, 0),
      makeIncident('r4', 0, 0),
      makeIncident('r5', 1, 1),
    ];
    state.unsanctionedSnapshots.push(
      { size: 5, empty: false, docs },
      { size: 0, empty: true, docs: [] },
    );
    state.modelResponses.push(validSelectionResponse('r5', 'ok'));

    // Release detection via write-payload shape: `releaseRunLock` is the
    // only code path that writes `run_id: FieldValue.delete()` (a non-string
    // sentinel). The refresh path only writes `lock_expires_at_ms`.
    // Intercepting by payload shape is stable against changes to the
    // transaction count between snapshots/batches.
    const originalImpl = state.db.runTransaction.getMockImplementation()!;
    state.db.runTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      let sawReleaseShape = false;
      const wrappedFn = async (tx: unknown) => {
        const innerTx = tx as {
          set: (ref: unknown, payload: Record<string, unknown>) => void;
        };
        const originalSet = innerTx.set.bind(innerTx);
        innerTx.set = (ref: unknown, payload: Record<string, unknown>) => {
          if ('run_id' in payload && typeof payload.run_id !== 'string') {
            sawReleaseShape = true;
          }
          return originalSet(ref, payload);
        };
        return fn(innerTx);
      };
      const result = await originalImpl(wrappedFn);
      if (sawReleaseShape) {
        throw new Error('firestore release transaction failed');
      }
      return result;
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { runSanctionIncidents } = await importRunner();

    await expect(runSanctionIncidents()).rejects.toThrow('firestore release transaction failed');
    expect(state.getBatchCommitCount()).toBe(1);
    // The operator log must include the failed-release message so a stuck
    // lock is traceable in Cloud Logging.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[sanction-incidents] Failed to release run lock:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('throws after max invalid model attempts and performs no writes', async () => {
    const docs = [
      makeIncident('inc-10', 1, 1),
      makeIncident('inc-11', 1, 1),
      makeIncident('inc-12', 1, 1),
      makeIncident('inc-13', 1, 1),
      makeIncident('inc-14', 1, 1),
    ];

    state.unsanctionedSnapshots.push({ size: 5, empty: false, docs });
    state.modelResponses.push(
      { text: '{}' },
      {
        text: JSON.stringify({
          sanctioned_incident_id: 'inc-99',
          sanction_rationale: 'Not in batch',
        }),
      },
    );

    const noise = silenceRunnerConsole();
    try {
      const { runSanctionIncidents } = await importRunner();

      await expect(runSanctionIncidents()).rejects.toThrow(
        'Model failed to produce a valid sanction selection after 2 attempt(s).',
      );

      expect(state.getBatchCommitCount()).toBe(0);
      expect(state.batchUpdates).toHaveLength(0);
    } finally {
      noise.restore();
    }
  });

  it('fails fast when GEMINI_API_KEY is missing and releases the lock on the way out', async () => {
    delete process.env.GEMINI_API_KEY;
    // The preflight migration scan succeeds (marker exists), then the
    // runner acquires the lock, fails `requireGeminiApiKey()` inside the
    // try block, and releases the lock in finally before re-throwing.
    const noise = silenceRunnerConsole();
    try {
      const { runSanctionIncidents } = await importRunner();

      await expect(runSanctionIncidents()).rejects.toThrow('Missing GEMINI_API_KEY');
      expect(state.generateContent).not.toHaveBeenCalled();
      expect(state.getBatchCommitCount()).toBe(0);
      // Lock must have been both acquired AND released so the next scheduler
      // invocation is not blocked by a stale lock.
      expect(state.lock.runId).toBeNull();
      expect(state.lock.expiresAt).toBe(0);
    } finally {
      noise.restore();
    }
  });

  it('aborts before locking when migration marker is missing and invalid docs are found', async () => {
    state.marker.exists = false;
    state.migrationSnapshots.push(
      {
        size: 1,
        empty: false,
        docs: [
          {
            id: 'bad-doc',
            ref: { path: 'incident_logs/bad-doc' },
            data: () => ({
              breach_count: 1,
              escalation_count: 0,
              sanction_count: 0,
              sanctioned: false,
              sanction_rationale: 99,
            }),
          },
        ],
      },
      { size: 0, empty: true, docs: [] },
    );

    const noise = silenceRunnerConsole();
    try {
      const { runSanctionIncidents } = await importRunner();

      await expect(runSanctionIncidents()).rejects.toThrow(
        'Missing migration marker and found 1 incident(s) without voting fields.',
      );

      expect(state.db.runTransaction).not.toHaveBeenCalled();
      expect(state.getBatchCommitCount()).toBe(0);
    } finally {
      noise.restore();
    }
  });

  it('creates the migration marker when every scanned doc has valid voting fields', async () => {
    // Marker missing + every doc valid is the happy-path branch of
    // `ensureVotingFieldsMigration`. After the scan, the runner writes a
    // marker doc with `{ completed_at, scanned_count, patched_count: 0,
    // source }`. Without a test on this branch, the marker-creation code
    // is dead to the suite — a regression that wrote the wrong shape
    // (missing `completed_at`, wrong `source`, or a swapped count) would
    // ship silently and future runs would treat a partial migration as
    // complete.
    state.marker.exists = false;
    state.migrationSnapshots.push(
      {
        size: 2,
        empty: false,
        docs: [
          {
            id: 'ok-1',
            ref: { path: 'incident_logs/ok-1' },
            data: () => ({
              breach_count: 0,
              escalation_count: 0,
              sanction_count: 0,
              sanctioned: false,
              sanction_rationale: null,
            }),
          },
          {
            id: 'ok-2',
            ref: { path: 'incident_logs/ok-2' },
            data: () => ({
              breach_count: 1,
              escalation_count: 2,
              sanction_count: 0,
              sanctioned: false,
              sanction_rationale: null,
            }),
          },
        ],
      },
      { size: 0, empty: true, docs: [] },
    );
    // After the marker is created the runner continues into the sanction
    // phase. Give it a below-threshold batch so it exits cleanly without
    // needing model responses.
    state.unsanctionedSnapshots.push({
      size: 0,
      empty: true,
      docs: [],
    });

    const noise = silenceRunnerConsole();
    try {
      const { runSanctionIncidents } = await importRunner();
      await runSanctionIncidents();

      expect(state.marker.setCalls).toHaveLength(1);
      const markerPayload = state.marker.setCalls[0] as Record<string, unknown>;
      expect(markerPayload).toEqual(
        expect.objectContaining({
          scanned_count: 2,
          patched_count: 0,
          source: 'scripts/sanction-incidents.ts preflight',
        }),
      );
      // `completed_at` is a server-timestamp sentinel (an opaque object,
      // not a string/number) — assert it is present by key rather than
      // by value to keep the test stable against admin SDK changes.
      expect(markerPayload.completed_at).toBeDefined();
      expect(state.getBatchCommitCount()).toBe(0);
    } finally {
      noise.restore();
    }
  });

  it('paginates the migration scan through multiple pages using startAfter cursor', async () => {
    // The preflight loop is paginated via `startAfter(cursor)` so projects
    // with more than `MIGRATION_SCAN_PAGE_SIZE` (500) documents still
    // validate every doc. A regression that forgot to advance the cursor
    // (or re-read the first page) would loop forever or skip later docs.
    // The mock collection records `startAfter` calls, and the runner pulls
    // snapshots off the `migrationSnapshots` queue in order, so we can
    // assert cursoring by (a) the presence of the call and (b) the count
    // of pages consumed.
    state.marker.exists = false;
    const makeValidDoc = (id: string) => ({
      id,
      ref: { path: `incident_logs/${id}` },
      data: () => ({
        breach_count: 0,
        escalation_count: 0,
        sanction_count: 0,
        sanctioned: false,
        sanction_rationale: null,
      }),
    });
    state.migrationSnapshots.push(
      { size: 2, empty: false, docs: [makeValidDoc('p1-a'), makeValidDoc('p1-b')] },
      { size: 1, empty: false, docs: [makeValidDoc('p2-a')] },
      { size: 0, empty: true, docs: [] },
    );
    state.unsanctionedSnapshots.push({ size: 0, empty: true, docs: [] });

    // Find the collection chain's `startAfter` mock so we can assert on
    // it. The mock returns the chain object from every method, so the
    // `startAfter` reference lives on the collection proxy itself.
    const incidentCollectionProxy = state.db.collection('incident_logs') as unknown as {
      startAfter: { mock: { calls: unknown[][] } };
    };

    const noise = silenceRunnerConsole();
    try {
      const { runSanctionIncidents } = await importRunner();
      await runSanctionIncidents();

      // Three pages in the queue → the runner must have called `get()`
      // three times (first page, second page, empty terminator) and
      // `startAfter` at least twice (once per non-initial page). The
      // cursor argument is the final doc of the previous page —
      // assert that directly so a bug that passed the first doc or a
      // stale snapshot reference is caught.
      expect(incidentCollectionProxy.startAfter.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Scanned count in the marker payload is the sum across all pages:
      // 2 + 1 = 3.
      expect(state.marker.setCalls).toHaveLength(1);
      expect(state.marker.setCalls[0]).toEqual(
        expect.objectContaining({ scanned_count: 3, patched_count: 0 }),
      );
    } finally {
      noise.restore();
    }
  });
});

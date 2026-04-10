// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      const tx = {
        get: vi.fn(async (ref: unknown) => {
          if (ref !== lockRef) {
            return { data: () => ({}) };
          }
          return {
            data: () => ({
              run_id: lock.runId,
              lock_expires_at_ms: lock.expiresAt,
            }),
          };
        }),
        set: vi.fn((ref: unknown, payload: Record<string, unknown>) => {
          if (ref !== lockRef) return;
          const runId = payload.run_id;
          const expiresAt = payload.lock_expires_at_ms;

          if (typeof runId === 'string') lock.runId = runId;
          if (typeof expiresAt === 'number') lock.expiresAt = expiresAt;
        }),
      };

      return fn(tx);
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
      reset: () => {
        marker.exists = true;
        marker.setCalls = [];
        lock.runId = null;
        lock.expiresAt = 0;
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

describe('runSanctionIncidents', () => {
  beforeEach(() => {
    state.reset();
    process.env.GEMINI_API_KEY = 'test-api-key';
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

    state.modelResponses.push({
      text: JSON.stringify({
        sanctioned_incident_id: 'inc-2',
        sanction_rationale: 'Highest impact failure profile.',
      }),
    });

    const { runSanctionIncidents } = await import('./sanction-incidents.js');
    await runSanctionIncidents();

    expect(state.getBatchCommitCount()).toBe(1);
    expect(state.batchUpdates).toHaveLength(1);
    expect(state.batchUpdates[0]).toEqual({
      ref: { path: 'incident_logs/inc-2' },
      payload: {
        sanctioned: true,
        sanction_count: 1,
        sanction_rationale: 'Highest impact failure profile.',
        impact_score: 17,
      },
    });
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

    const { runSanctionIncidents } = await import('./sanction-incidents.js');

    await expect(runSanctionIncidents()).rejects.toThrow(
      'Model failed to produce a valid sanction selection after 2 attempt(s).',
    );

    expect(state.getBatchCommitCount()).toBe(0);
    expect(state.batchUpdates).toHaveLength(0);
  });

  it('fails fast when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    state.unsanctionedSnapshots.push({ size: 0, empty: true, docs: [] });

    const { runSanctionIncidents } = await import('./sanction-incidents.js');

    await expect(runSanctionIncidents()).rejects.toThrow('Missing GEMINI_API_KEY');
    expect(state.getBatchCommitCount()).toBe(0);
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

    const { runSanctionIncidents } = await import('./sanction-incidents.js');

    await expect(runSanctionIncidents()).rejects.toThrow(
      'Missing migration marker and found 1 incident(s) without voting fields.',
    );

    expect(state.db.runTransaction).not.toHaveBeenCalled();
    expect(state.getBatchCommitCount()).toBe(0);
  });
});

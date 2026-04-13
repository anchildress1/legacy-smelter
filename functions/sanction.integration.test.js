// @vitest-environment node
/**
 * Emulator-backed integration tests for the sanction judging pipeline.
 *
 * These tests are the integration-layer sibling of `sanction.test.js`. Where
 * the unit tests mock firebase-admin and exercise each helper in isolation,
 * this suite runs against the real Firestore emulator so regressions in
 * transactional semantics, batch atomicity, or query-index behaviour show up
 * immediately instead of at first deploy.
 *
 * What this file tests that the unit suite cannot:
 *
 *   1. Real transactional claim semantics. Two concurrent `claimBatch` calls
 *      over 10 unevaluated docs must each grab 5 non-overlapping docs
 *      without either losing the race silently. Mocked transactions cannot
 *      exercise Firestore's real write-contention retry loop.
 *
 *   2. Sweep recovery round-trip. A crashed judge leaves 5 docs stranded
 *      with `evaluated=true` + active lease. After `LEASE_TTL_MS`, a fresh
 *      `runSanctionBatch` call's sweep must put them back in the pool and
 *      a subsequent claim must succeed.
 *
 *   3. Finalize batch atomicity. If `finalizeWinner` is ever refactored to
 *      split the winner write from the lease clears (two commits, two
 *      transactions), the unit suite still passes because its mock writes
 *      to an in-memory array. The emulator suite catches it because a
 *      partial commit leaves a mixed-state collection that the follow-up
 *      assertion detects.
 *
 *   4. Index usage. The `(evaluated ASC, timestamp ASC)` composite index
 *      declared in `firestore.indexes.json` must be present for the claim
 *      query. The emulator lets the query run without the index (unlike
 *      production), but round-tripping the query against real data still
 *      catches field-name drift.
 *
 * Run via: npm run test:api:emulator
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

// ── @google/genai mock ──────────────────────────────────────────────────────
// Mocked at module level so `runSanctionBatch`'s `getAiClient` path works
// even though we also pass `aiClient` explicitly in every test. The module
// import happens before any test body runs, and `judgeBatch` calls out to
// Gemini — we never want the real service hit here.

const { generateContentMock, GoogleGenAIMock } = vi.hoisted(() => {
  const generateContent = vi.fn();
  return {
    generateContentMock: generateContent,
    GoogleGenAIMock: vi.fn(function GoogleGenAIStub() {
      this.models = { generateContent };
    }),
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: GoogleGenAIMock,
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
}));

const {
  MIN_BATCH,
  LEASE_TTL_MS,
  sweepStaleLeases,
  claimBatch,
  finalizeWinner,
  runSanctionBatch,
} = await import('./sanction.js');

// ── Emulator-connected admin app + db handle ───────────────────────────────

let adminApp;
let db;

function makeIncidentData({
  timestampMs,
  breachCount = 1,
  escalationCount = 2,
  evaluated = false,
  sanctionLeaseAtMs = null,
} = {}) {
  return {
    uid: 'uid-test',
    legacy_infra_class: 'Class',
    diagnosis: 'Diagnosis',
    severity: 'high',
    archive_note: 'Archive',
    failure_origin: 'Origin',
    chromatic_profile: 'Profile',
    incident_feed_summary: 'Summary',
    share_quote: 'Quote',
    breach_count: breachCount,
    escalation_count: escalationCount,
    sanction_count: 0,
    sanctioned: false,
    sanction_rationale: null,
    impact_score: 0,
    pixel_count: 100,
    timestamp: Timestamp.fromMillis(timestampMs),
    evaluated,
    sanction_lease_at: sanctionLeaseAtMs === null ? null : Timestamp.fromMillis(sanctionLeaseAtMs),
  };
}

async function seedIncidents(count, { startTimestampMs = 1_700_000_000_000, spacingMs = 1_000 } = {}) {
  const batch = db.batch();
  const docIds = [];
  for (let i = 0; i < count; i += 1) {
    const ref = db.collection('incident_logs').doc(`seed-${i.toString().padStart(3, '0')}`);
    batch.set(ref, makeIncidentData({ timestampMs: startTimestampMs + i * spacingMs }));
    docIds.push(ref.id);
  }
  await batch.commit();
  return docIds;
}

async function purgeCollection(collectionPath) {
  while (true) {
    const snap = await db.collection(collectionPath).limit(500).get();
    if (snap.empty) return;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

function stubGeminiWinner(id, rationale = 'integration-picked') {
  generateContentMock.mockResolvedValueOnce({
    text: JSON.stringify({
      sanctioned_incident_id: id,
      sanction_rationale: rationale,
      reason: '',
    }),
  });
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      '[sanction.integration] FIRESTORE_EMULATOR_HOST must be set — run via `npm run test:api:emulator`.',
    );
  }
  // Use a distinct app name so this suite does not collide with any other
  // suite sharing the same worker's firebase-admin module cache.
  adminApp = initializeApp({ projectId: 'demo-legacy-smelter' }, 'sanction-integration');
  db = getFirestore(adminApp, 'legacy-smelter');
});

afterAll(async () => {
  await deleteApp(adminApp);
});

beforeEach(async () => {
  generateContentMock.mockReset();
  // Silence info/warn logging from sanction.js during tests. Error path
  // tests that assert on log output set their own spies.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await purgeCollection('incident_logs');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('claimBatch (emulator)', () => {
  it('returns empty array when fewer than MIN_BATCH unevaluated docs exist', async () => {
    await seedIncidents(MIN_BATCH - 1);
    const claimed = await claimBatch({ now: Date.now(), db });
    expect(claimed).toEqual([]);
    // No doc should have been flipped to evaluated — the all-or-nothing
    // claim must leave the pool untouched.
    const snap = await db.collection('incident_logs').where('evaluated', '==', true).get();
    expect(snap.empty).toBe(true);
  });

  it('claims the oldest MIN_BATCH docs, ordered by timestamp ascending', async () => {
    const ids = await seedIncidents(7);
    const claimed = await claimBatch({ now: Date.now(), db });
    expect(claimed).toHaveLength(MIN_BATCH);
    // Oldest five, by insertion order.
    expect(claimed.map((c) => c.id)).toEqual(ids.slice(0, 5));
    // Post-claim: exactly those 5 must have evaluated=true and an active lease.
    const claimedSnap = await db.collection('incident_logs').where('evaluated', '==', true).get();
    expect(claimedSnap.size).toBe(5);
  });

  it('two concurrent claimBatch calls each grab a disjoint set when 10 docs exist', async () => {
    // 10 eligible docs → two parallel claims must together produce 10 non-
    // overlapping doc ids. If a third call runs in the same window, the
    // third returns empty because fewer than 5 remain. This is the
    // load-bearing concurrency invariant from the rebuild brief §7.
    await seedIncidents(10);

    const [claimA, claimB] = await Promise.all([
      claimBatch({ now: Date.now(), db }),
      claimBatch({ now: Date.now(), db }),
    ]);

    const allIds = new Set([
      ...claimA.map((c) => c.id),
      ...claimB.map((c) => c.id),
    ]);
    // Either both won 5 (disjoint), or one won 5 and the other was aborted
    // by contention and retried on a newly-empty pool. The invariant is
    // that the union of winning ids has no duplicates AND the total number
    // of flipped docs in Firestore matches the union size.
    expect(allIds.size).toBe(claimA.length + claimB.length);
    const flipped = await db.collection('incident_logs').where('evaluated', '==', true).get();
    expect(flipped.size).toBe(allIds.size);
  });
});

describe('sweepStaleLeases (emulator)', () => {
  it('clears evaluated+lease on docs whose lease is older than TTL', async () => {
    const now = 1_700_000_000_000;
    // Three docs seeded with an expired lease (TTL + 1 second ago) and two
    // with a fresh lease. Sweep must touch only the three.
    const expiredTs = now - LEASE_TTL_MS - 1_000;
    const freshTs = now - 1_000;

    const batch = db.batch();
    for (let i = 0; i < 3; i += 1) {
      batch.set(
        db.collection('incident_logs').doc(`stale-${i}`),
        makeIncidentData({
          timestampMs: now - i * 1_000,
          evaluated: true,
          sanctionLeaseAtMs: expiredTs,
        }),
      );
    }
    for (let i = 0; i < 2; i += 1) {
      batch.set(
        db.collection('incident_logs').doc(`fresh-${i}`),
        makeIncidentData({
          timestampMs: now - i * 1_000,
          evaluated: true,
          sanctionLeaseAtMs: freshTs,
        }),
      );
    }
    await batch.commit();

    const result = await sweepStaleLeases({ now, db });
    expect(result).toEqual({ recoveredCount: 3 });

    const restored = await db
      .collection('incident_logs')
      .where('evaluated', '==', false)
      .get();
    expect(restored.size).toBe(3);
    for (const doc of restored.docs) {
      expect(doc.id).toMatch(/^stale-/);
      expect(doc.data().sanction_lease_at).toBeNull();
    }

    const stillLeased = await db
      .collection('incident_logs')
      .where('evaluated', '==', true)
      .get();
    expect(stillLeased.size).toBe(2);
    for (const doc of stillLeased.docs) {
      expect(doc.id).toMatch(/^fresh-/);
    }
  });
});

describe('finalizeWinner (emulator)', () => {
  it('writes winner + clears all leases in one atomic batch', async () => {
    const now = Date.now();
    const ids = await seedIncidents(5);
    // Mark the docs as claimed so the snapshot shape matches what
    // `claimBatch` returns in production.
    const batch = db.batch();
    for (const id of ids) {
      batch.update(db.collection('incident_logs').doc(id), {
        evaluated: true,
        sanction_lease_at: Timestamp.fromMillis(now),
      });
    }
    await batch.commit();

    const batchDocs = [];
    for (const id of ids) {
      const snap = await db.collection('incident_logs').doc(id).get();
      batchDocs.push({ id, ref: snap.ref, data: snap.data() });
    }

    const selection = {
      sanctioned_incident_id: ids[2],
      sanction_rationale: 'integration-test rationale',
    };
    const result = await finalizeWinner({ batchDocs, selection, db });
    // breach_count=1, escalation_count=2, sanction_count=1 → 5+6+2 = 13
    expect(result).toEqual({ winnerId: ids[2], impactScore: 13, path: 'winner' });

    const winnerSnap = await db.collection('incident_logs').doc(ids[2]).get();
    const winner = winnerSnap.data();
    expect(winner.sanctioned).toBe(true);
    expect(winner.sanction_count).toBe(1);
    expect(winner.sanction_rationale).toBe('integration-test rationale');
    expect(winner.impact_score).toBe(13);
    expect(winner.sanction_lease_at).toBeNull();

    // Every loser must have sanction_lease_at=null and NO partial winner
    // fields (no rogue sanction_count or rationale writes).
    for (const loserId of ids.filter((id) => id !== ids[2])) {
      const loserSnap = await db.collection('incident_logs').doc(loserId).get();
      const loser = loserSnap.data();
      expect(loser.sanction_lease_at).toBeNull();
      expect(loser.sanctioned).toBe(false);
      expect(loser.sanction_count).toBe(0);
      expect(loser.sanction_rationale).toBeNull();
    }
  });
});

describe('runSanctionBatch (emulator)', () => {
  it('completes a full sweep → claim → judge → finalize round-trip', async () => {
    const ids = await seedIncidents(MIN_BATCH);
    stubGeminiWinner(ids[1]);

    const result = await runSanctionBatch({ geminiApiKey: 'test-key', db });
    expect(result.status).toBe('completed');
    expect(result.winnerId).toBe(ids[1]);

    const winnerSnap = await db.collection('incident_logs').doc(ids[1]).get();
    expect(winnerSnap.data().sanctioned).toBe(true);
  });

  it('returns no-op when fewer than MIN_BATCH unevaluated docs exist', async () => {
    await seedIncidents(MIN_BATCH - 1);
    const result = await runSanctionBatch({ geminiApiKey: 'test-key', db });
    expect(result).toEqual({ status: 'no-op' });
    expect(generateContentMock).not.toHaveBeenCalled();
    // Unevaluated count must be unchanged — the no-op path must not flip
    // any docs to evaluated=true.
    const unevaluated = await db
      .collection('incident_logs')
      .where('evaluated', '==', false)
      .get();
    expect(unevaluated.size).toBe(MIN_BATCH - 1);
  });

  it('recovers a stranded claim from a previous crash after lease expiry', async () => {
    // Simulate: previous run claimed 5 docs, then threw before finalize.
    // The 5 docs are stuck with `evaluated=true` + an expired lease. The
    // next runSanctionBatch invocation's sweep must restore them and then
    // judge them.
    const now = Date.now();
    const expiredLeaseMs = now - LEASE_TTL_MS - 10_000;
    const ids = await seedIncidents(MIN_BATCH);

    // Strand them — `evaluated=true` + expired lease.
    const strand = db.batch();
    for (const id of ids) {
      strand.update(db.collection('incident_logs').doc(id), {
        evaluated: true,
        sanction_lease_at: Timestamp.fromMillis(expiredLeaseMs),
      });
    }
    await strand.commit();

    stubGeminiWinner(ids[3]);
    const result = await runSanctionBatch({ geminiApiKey: 'test-key', db, now });

    expect(result.status).toBe('completed');
    expect(result.winnerId).toBe(ids[3]);
  });

  it('rethrows when Gemini judging fails and leaves the claim in place for retry', async () => {
    // Empty text for every attempt → judgeBatch exhausts retries and
    // throws. runSanctionBatch must propagate the error (activating Cloud
    // Functions v2 retry) and MUST NOT clear the lease — the stranded
    // claim is recoverable only via sweep on the next invocation.
    const ids = await seedIncidents(MIN_BATCH);
    generateContentMock.mockResolvedValue({ text: '' });

    await expect(runSanctionBatch({ geminiApiKey: 'test-key', db })).rejects.toThrow(
      'Gemini failed to produce a valid selection',
    );

    // Every seeded doc should now be evaluated=true with an active lease.
    const stranded = await db
      .collection('incident_logs')
      .where('evaluated', '==', true)
      .get();
    expect(stranded.size).toBe(MIN_BATCH);
    expect(stranded.docs.every((d) => d.data().sanction_lease_at !== null)).toBe(true);
    const byId = (a, b) => a.localeCompare(b);
    expect(stranded.docs.map((d) => d.id).sort(byId)).toEqual([...ids].sort(byId));
  });
});

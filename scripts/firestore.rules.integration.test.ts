// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Intentionally distinct from the `firebase emulators:exec --project
// demo-legacy-smelter` project used by the npm script: @firebase/rules-
// unit-testing creates a virtual project inside the same emulator
// instance, so the rules tests and the API emulator tests can coexist
// without clobbering each other's Firestore state. Do not "normalize"
// this to match the CLI's --project flag — they serve different layers.
const PROJECT_ID = 'demo-legacy-smelter-rules';

function getEmulatorHostPort() {
  const hostAndPort = process.env.FIRESTORE_EMULATOR_HOST;
  if (!hostAndPort) {
    throw new Error('FIRESTORE_EMULATOR_HOST must be set (run via firebase emulators:exec).');
  }
  const [host, rawPort] = hostAndPort.split(':');
  const port = Number.parseInt(rawPort ?? '', 10);
  if (!host || !Number.isFinite(port)) {
    throw new Error(`Invalid FIRESTORE_EMULATOR_HOST value: ${hostAndPort}`);
  }
  return { host, port };
}

const BASE_INCIDENT = {
  breach_count: 0,
  escalation_count: 0,
  sanction_count: 0,
  impact_score: 0,
  sanctioned: false,
  sanction_rationale: null,
};

let testEnv: RulesTestEnvironment;

async function seedIncident(
  incidentId: string,
  patch: Partial<typeof BASE_INCIDENT> = {},
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'incident_logs', incidentId), {
      ...BASE_INCIDENT,
      ...patch,
    });
  });
}

async function seedEscalation(incidentId: string, uid: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'incident_logs', incidentId, 'escalations', uid), {
      uid,
      timestamp: serverTimestamp(),
    });
  });
}

describe('firestore.rules invariants', () => {
  beforeAll(async () => {
    const { host, port } = getEmulatorHostPort();
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host,
        port,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('allows breach increment only when impact_score is updated to the exact weighted value', async () => {
    const db = testEnv.authenticatedContext('u-breach').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-breach');

    await seedIncident('inc-breach');

    await assertSucceeds(
      updateDoc(incidentRef, {
        breach_count: 1,
        impact_score: 2,
      }),
    );

    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 2,
      }),
    );

    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 2,
        impact_score: 999,
      }),
    );
  });

  it('rejects unauthenticated breach increments even with a well-formed payload', async () => {
    await seedIncident('inc-unauth-breach');

    const db = testEnv.unauthenticatedContext().firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-unauth-breach');

    // The update shape would succeed for an authenticated user, but the
    // `request.auth != null` guard on the update rule must reject
    // anonymous callers. A regression that drops that guard — e.g. during
    // a refactor — needs to be caught here, not in production.
    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 1,
        impact_score: 2,
      }),
    );
  });

  it('rejects breach decrements — the counter is a one-way ratchet', async () => {
    // `isBreachIncrement` only accepts `breach_count + 1` (+2 impact), and
    // there is no `isBreachDecrement` helper in firestore.rules. This test
    // pins that invariant: a future rule that adds a breach decrement path
    // (e.g. for moderation rollback) must land with its own test, not
    // silently flip the ratchet from this file.
    await seedIncident('inc-breach-decrement', {
      breach_count: 3,
      impact_score: 6,
    });

    const db = testEnv.authenticatedContext('u-breach-dec').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-breach-decrement');

    // Decrement by 1 with an internally-consistent impact_score. Must fail.
    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 2,
        impact_score: 4,
      }),
    );

    // Reset to zero with a zero impact_score. Must also fail.
    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 0,
        impact_score: 0,
      }),
    );
  });

  it('rejects increments from non-contiguous counter states', async () => {
    // Seed with breach_count: 5 so the "increment from non-zero" code path
    // is exercised. Only `+1` (6, 12) should succeed — any other delta is
    // rejected even when the payload's impact_score matches the claimed
    // counters.
    await seedIncident('inc-non-zero-breach', {
      breach_count: 5,
      impact_score: 10,
    });

    const db = testEnv.authenticatedContext('u-nzbreach').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-non-zero-breach');

    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 7,
        impact_score: 14,
      }),
    );

    await assertSucceeds(
      updateDoc(incidentRef, {
        breach_count: 6,
        impact_score: 12,
      }),
    );
  });

  it('rejects multi-counter updates that touch both breach_count and escalation_count', async () => {
    await seedIncident('inc-multi');

    const db = testEnv.authenticatedContext('u-multi').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-multi');

    // `affectedKeys().hasOnly(['breach_count', 'impact_score'])` is the
    // single-counter guard. Writing two counters at once — even if the
    // impact_score is internally consistent — must fail.
    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 1,
        escalation_count: 1,
        impact_score: 5,
      }),
    );
  });

  it('allows escalation increment only when paired with escalation subdoc create in the same batch', async () => {
    await seedIncident('inc-esc-up');

    const db = testEnv.authenticatedContext('u-esc').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-esc-up');
    const escalationRef = doc(db, 'incident_logs', 'inc-esc-up', 'escalations', 'u-esc');

    const validBatch = writeBatch(db);
    validBatch.update(incidentRef, {
      escalation_count: 1,
      impact_score: 3,
    });
    validBatch.set(escalationRef, {
      uid: 'u-esc',
      timestamp: serverTimestamp(),
    });
    await assertSucceeds(validBatch.commit());

    await seedIncident('inc-esc-up-missing-subdoc');
    const missingSubdocRef = doc(db, 'incident_logs', 'inc-esc-up-missing-subdoc');
    await assertFails(
      updateDoc(missingSubdocRef, {
        escalation_count: 1,
        impact_score: 3,
      }),
    );
  });

  it('rejects escalation increment with drifted impact_score even when subdoc is paired', async () => {
    await seedIncident('inc-esc-drift');

    const db = testEnv.authenticatedContext('u-drift').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-esc-drift');
    const escalationRef = doc(db, 'incident_logs', 'inc-esc-drift', 'escalations', 'u-drift');

    // A batch that pairs subdoc creation with the counter increment but
    // writes a non-matching `impact_score` must be rejected. Without this
    // check, a regression on the escalation rule's `impactScore()`
    // equality would silently allow drifted totals to leak into the
    // feed sort.
    const driftedBatch = writeBatch(db);
    driftedBatch.update(incidentRef, {
      escalation_count: 1,
      impact_score: 999,
    });
    driftedBatch.set(escalationRef, {
      uid: 'u-drift',
      timestamp: serverTimestamp(),
    });
    await assertFails(driftedBatch.commit());
  });

  it('rejects users attempting to create an escalation subdoc under another user id', async () => {
    await seedIncident('inc-esc-cross');

    const attackerDb = testEnv.authenticatedContext('u-attacker').firestore();
    const incidentRef = doc(attackerDb, 'incident_logs', 'inc-esc-cross');
    const victimEscalationRef = doc(
      attackerDb,
      'incident_logs',
      'inc-esc-cross',
      'escalations',
      'u-victim',
    );

    // Pair a valid parent increment with a subdoc keyed on another user's
    // id. The rule `escId == request.auth.uid` on the subcollection must
    // reject this impersonation attempt even though the parent delta is
    // structurally valid. This exercises the path guard only — see the
    // body-tamper test below for the `request.resource.data.uid ==
    // request.auth.uid` check on the subdoc payload itself.
    const impersonationBatch = writeBatch(attackerDb);
    impersonationBatch.update(incidentRef, {
      escalation_count: 1,
      impact_score: 3,
    });
    impersonationBatch.set(victimEscalationRef, {
      uid: 'u-victim',
      timestamp: serverTimestamp(),
    });
    await assertFails(impersonationBatch.commit());
  });

  it('rejects escalation subdoc where body uid does not match the authenticated caller', async () => {
    // Body-tamper variant of the impersonation test: the subdoc is keyed on
    // the attacker's own uid (so the path guard `escId == request.auth.uid`
    // passes), but the payload's `uid` field carries a different user's id.
    // The rule `request.resource.data.uid == request.auth.uid` at
    // firestore.rules:102 is the sole guard against this attack shape. A
    // regression that dropped it would let an attacker plant a subdoc whose
    // body claimed a different owner, corrupting any downstream consumer
    // that trusted the embedded `uid`.
    await seedIncident('inc-esc-body-tamper');

    const attackerDb = testEnv.authenticatedContext('u-attacker').firestore();
    const incidentRef = doc(attackerDb, 'incident_logs', 'inc-esc-body-tamper');
    const attackerEscalationRef = doc(
      attackerDb,
      'incident_logs',
      'inc-esc-body-tamper',
      'escalations',
      'u-attacker',
    );

    const bodyTamperBatch = writeBatch(attackerDb);
    bodyTamperBatch.update(incidentRef, {
      escalation_count: 1,
      impact_score: 3,
    });
    bodyTamperBatch.set(attackerEscalationRef, {
      uid: 'u-victim',
      timestamp: serverTimestamp(),
    });
    await assertFails(bodyTamperBatch.commit());
  });

  it('rejects escalation subdoc carrying extra keys beyond uid and timestamp', async () => {
    // `request.resource.data.keys().hasOnly(['uid', 'timestamp'])` at
    // firestore.rules:100 is the guard that prevents clients from smuggling
    // arbitrary fields into the subdoc (e.g. `admin: true`, a drifted
    // `escalation_count` mirror, or any field that a downstream reader
    // might trust). A regression that loosened this constraint would let
    // any attacker bloat the doc with attacker-controlled fields while the
    // parent counter update still looked structurally valid.
    await seedIncident('inc-esc-extra-keys');

    const db = testEnv.authenticatedContext('u-extra').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-esc-extra-keys');
    const escalationRef = doc(
      db,
      'incident_logs',
      'inc-esc-extra-keys',
      'escalations',
      'u-extra',
    );

    const extraKeysBatch = writeBatch(db);
    extraKeysBatch.update(incidentRef, {
      escalation_count: 1,
      impact_score: 3,
    });
    extraKeysBatch.set(escalationRef, {
      uid: 'u-extra',
      timestamp: serverTimestamp(),
      foo: 'bar',
    });
    await assertFails(extraKeysBatch.commit());
  });

  it('rejects client writes that touch sanction_count', async () => {
    // `isBreachIncrement` / `isEscalationIncrement` / `isEscalationDecrement`
    // each lock `affectedKeys().hasOnly([...])` to the breach or escalation
    // counter plus `impact_score`. Neither rule permits `sanction_count` in
    // the affected keys, so any client attempt to poke that field — even
    // paired with a correctly-weighted `impact_score` — must be rejected.
    // `sanction_count` is server-only (admin SDK bypass via
    // scripts/sanction-incidents.ts). A regression that added
    // `sanction_count` to any `hasOnly` list would silently open the voting
    // outcome to client tampering.
    await seedIncident('inc-sanction-client', {
      breach_count: 0,
      escalation_count: 0,
      sanction_count: 0,
    });

    const db = testEnv.authenticatedContext('u-sanction').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-sanction-client');

    // Pure sanction_count increment with a matching impact_score (5×1 = 5).
    await assertFails(
      updateDoc(incidentRef, {
        sanction_count: 1,
        impact_score: 5,
      }),
    );

    // Smuggling sanction_count into an otherwise-valid breach increment.
    await assertFails(
      updateDoc(incidentRef, {
        breach_count: 1,
        sanction_count: 1,
        impact_score: 7,
      }),
    );
  });

  it('allows escalation decrement only when paired with subdoc delete and denies decrement at zero', async () => {
    await seedIncident('inc-esc-down', {
      escalation_count: 1,
      impact_score: 3,
    });
    await seedEscalation('inc-esc-down', 'u-esc-down');

    const db = testEnv.authenticatedContext('u-esc-down').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-esc-down');
    const escalationRef = doc(db, 'incident_logs', 'inc-esc-down', 'escalations', 'u-esc-down');

    const validBatch = writeBatch(db);
    validBatch.update(incidentRef, {
      escalation_count: 0,
      impact_score: 0,
    });
    validBatch.delete(escalationRef);
    await assertSucceeds(validBatch.commit());

    await seedIncident('inc-esc-zero');
    const zeroRef = doc(db, 'incident_logs', 'inc-esc-zero');
    await assertFails(
      updateDoc(zeroRef, {
        escalation_count: -1,
        impact_score: -3,
      }),
    );
  });

  it('rejects escalation decrement when subdoc delete is omitted from the batch', async () => {
    // The parent decrement rule requires `!existsAfter(escalationDocPath)`.
    // Updating the counter without deleting the subdoc in the same batch
    // must fail — otherwise the subdoc and parent counter could diverge.
    await seedIncident('inc-esc-dec-orphan', {
      escalation_count: 1,
      impact_score: 3,
    });
    await seedEscalation('inc-esc-dec-orphan', 'u-dec');

    const db = testEnv.authenticatedContext('u-dec').firestore();
    const incidentRef = doc(db, 'incident_logs', 'inc-esc-dec-orphan');

    await assertFails(
      updateDoc(incidentRef, {
        escalation_count: 0,
        impact_score: 0,
      }),
    );
  });

  it('rejects escalation subdoc delete when parent counter is not decremented', async () => {
    // Inverse of the orphan-parent case: deleting the subdoc without
    // touching the parent counter leaves the parent at `escalation_count:
    // 1` with no owning subdoc. The rule on the subcollection's
    // `allow delete` requires `parentEscalationDecremented()`.
    await seedIncident('inc-esc-subdoc-orphan', {
      escalation_count: 1,
      impact_score: 3,
    });
    await seedEscalation('inc-esc-subdoc-orphan', 'u-sub');

    const db = testEnv.authenticatedContext('u-sub').firestore();
    const escalationRef = doc(
      db,
      'incident_logs',
      'inc-esc-subdoc-orphan',
      'escalations',
      'u-sub',
    );

    await assertFails(deleteDoc(escalationRef));
  });

  it('denies incident creates and global_stats writes from clients', async () => {
    const db = testEnv.authenticatedContext('u-create').firestore();

    await assertFails(
      setDoc(doc(db, 'incident_logs', 'client-created'), {
        ...BASE_INCIDENT,
      }),
    );

    await assertFails(
      setDoc(doc(db, 'global_stats', 'main'), {
        total_pixels_melted: 123,
      }),
    );
  });

  it('allows public reads for incident logs and global stats', async () => {
    await seedIncident('inc-read');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'global_stats', 'main'), {
        total_pixels_melted: 456,
      });
    });

    const db = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(db, 'incident_logs', 'inc-read')));
    const statsSnap = await assertSucceeds(getDoc(doc(db, 'global_stats', 'main')));
    expect(statsSnap.data()).toEqual({ total_pixels_melted: 456 });

    await assertFails(deleteDoc(doc(db, 'incident_logs', 'inc-read')));
  });
});

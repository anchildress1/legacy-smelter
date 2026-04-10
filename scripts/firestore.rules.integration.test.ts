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

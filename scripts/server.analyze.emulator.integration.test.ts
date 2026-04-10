// @vitest-environment node
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../shared/admin-init.js';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6mF7sAAAAASUVORK5CYII=';

const { state } = vi.hoisted(() => {
  const verifyIdToken = vi.fn(async () => ({ uid: 'user-1' }));
  const generateContent = vi.fn(async () => ({ text: '' }));

  const GoogleGenAI = vi.fn(function GoogleGenAIMock(this: { models: { generateContent: typeof generateContent } }) {
    this.models = { generateContent };
  });

  return {
    state: {
      verifyIdToken,
      generateContent,
      GoogleGenAI,
      reset: () => {
        verifyIdToken.mockClear();
        verifyIdToken.mockResolvedValue({ uid: 'user-1' });
        generateContent.mockClear();
        generateContent.mockResolvedValue({ text: '' });
        GoogleGenAI.mockClear();
      },
    },
  };
});

vi.mock('../shared/admin-init.js', async () => {
  const actual = await vi.importActual<typeof import('../shared/admin-init.js')>('../shared/admin-init.js');
  return {
    ...actual,
    getAdminAuth: () => ({ verifyIdToken: state.verifyIdToken }),
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: state.GoogleGenAI,
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    ARRAY: 'ARRAY',
    NUMBER: 'NUMBER',
  },
}));

interface ServerModule {
  app: import('express').Express;
  resetAnalyzeRateLimitStateForTests: () => void;
  stopRateLimitCleanupIntervalForTests: () => void;
}

function buildGeminiResponseText() {
  return JSON.stringify({
    legacy_infra_class: 'Artifact Node',
    diagnosis: 'Critical mismatch detected',
    dominant_hex_colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'],
    chromatic_profile: 'Thermal Beige',
    system_dx: 'Acute Drift Syndrome with brittle memory',
    severity: 'Severe',
    primary_contamination: 'Legacy residue',
    contributing_factor: 'Config rot',
    failure_origin: 'A decade of deferred upgrades and one sticky note.',
    disposition: 'Immediate thermal decommission with evidence retained.',
    incident_feed_summary: 'Critical legacy artifact queued for smelting.',
    archive_note: 'System observed dangerous drift. Artifact continued operating as if this was normal.',
    og_headline: 'Legacy artifact breached thermal policy',
    share_quote: 'Containment failed. Smelting initiated.',
    anon_handle: 'ThermalOperator_41',
    subject_box: [0, 0, 1000, 1000],
  });
}

async function purgeCollection(path: string): Promise<void> {
  const db = getDb();
  while (true) {
    const snap = await db.collection(path).limit(500).get();
    if (snap.empty) return;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

async function importServer(): Promise<ServerModule> {
  vi.resetModules();
  // @ts-expect-error server.js is intentionally plain JS runtime code.
  return import('../server.js') as Promise<ServerModule>;
}

describe('POST /api/analyze against Firestore emulator', () => {
  let serverModule: ServerModule | null = null;

  beforeAll(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('FIRESTORE_EMULATOR_HOST must be set (run via firebase emulators:exec).');
    }

    process.env.FIREBASE_PROJECT_ID = 'demo-legacy-smelter';
    process.env.FIREBASE_FIRESTORE_DATABASE_ID = 'legacy-smelter';
    process.env.VITE_APP_URL = 'https://legacy-smelter.test';
    process.env.GEMINI_API_KEY = 'test-key';

    serverModule = await importServer();
  });

  beforeEach(async () => {
    state.reset();
    serverModule?.resetAnalyzeRateLimitStateForTests();
    await purgeCollection('incident_logs');
    await getDb().collection('global_stats').doc('main').set({ total_pixels_melted: 0 });
  });

  afterAll(async () => {
    serverModule?.stopRateLimitCleanupIntervalForTests();
  });

  it('persists incident + global stats with expected invariant fields', async () => {
    state.generateContent.mockResolvedValue({ text: buildGeminiResponseText() });

    const response = await request(serverModule!.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(200);
    const incidentId = response.body.incidentId as string;

    const incidentSnap = await getDb().collection('incident_logs').doc(incidentId).get();
    expect(incidentSnap.exists).toBe(true);
    expect(incidentSnap.data()).toEqual(
      expect.objectContaining({
        uid: 'user-1',
        pixel_count: 1,
        breach_count: 0,
        escalation_count: 0,
        sanction_count: 0,
        impact_score: 0,
        sanctioned: false,
        sanction_rationale: null,
      }),
    );

    const statsSnap = await getDb().collection('global_stats').doc('main').get();
    expect(statsSnap.data()?.total_pixels_melted).toBe(1);
  });

  it('does not write incident or stats when auth is invalid', async () => {
    state.verifyIdToken.mockRejectedValue(new Error('invalid token'));
    state.generateContent.mockResolvedValue({ text: buildGeminiResponseText() });

    const response = await request(serverModule!.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer bad-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(401);

    const incidentSnap = await getDb().collection('incident_logs').limit(1).get();
    expect(incidentSnap.empty).toBe(true);

    const statsSnap = await getDb().collection('global_stats').doc('main').get();
    expect(statsSnap.data()?.total_pixels_melted).toBe(0);
  });

  it('does not write incident or stats when Gemini analysis fails', async () => {
    state.generateContent.mockRejectedValue(new Error('model outage'));

    const response = await request(serverModule!.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(502);

    const incidentSnap = await getDb().collection('incident_logs').limit(1).get();
    expect(incidentSnap.empty).toBe(true);

    const statsSnap = await getDb().collection('global_stats').doc('main').get();
    expect(statsSnap.data()?.total_pixels_melted).toBe(0);
  });
});

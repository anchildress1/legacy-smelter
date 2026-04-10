// @vitest-environment node
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6mF7sAAAAASUVORK5CYII=';

type BatchCall = {
  ref: { path: string; id?: string };
  payload: Record<string, unknown>;
  options?: Record<string, unknown>;
};

const { state } = vi.hoisted(() => {
  const verifyIdToken = vi.fn(async () => ({ uid: 'user-1' }));
  const generateContent = vi.fn(async () => ({ text: '' }));

  const batchCalls: BatchCall[] = [];
  let commitImpl: () => Promise<void> = async () => {};
  let incidentIdCounter = 0;

  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'incident_logs') {
        return {
          doc: vi.fn(() => {
            incidentIdCounter += 1;
            const id = `incident-${incidentIdCounter}`;
            return { id, path: `incident_logs/${id}` };
          }),
        };
      }
      if (name === 'global_stats') {
        return {
          doc: vi.fn((id: string) => ({ id, path: `global_stats/${id}` })),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    }),
    batch: vi.fn(() => ({
      set: vi.fn((ref: { path: string; id?: string }, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        batchCalls.push({ ref, payload, options });
      }),
      commit: vi.fn(async () => {
        await commitImpl();
      }),
    })),
  };

  const getDb = vi.fn(() => db);
  const getAdminAuth = vi.fn(() => ({ verifyIdToken }));

  const GoogleGenAI = vi.fn(function GoogleGenAIMock(this: { models: { generateContent: typeof generateContent } }) {
    this.models = { generateContent };
  });

  return {
    state: {
      verifyIdToken,
      generateContent,
      getDb,
      getAdminAuth,
      GoogleGenAI,
      batchCalls,
      setCommitImpl: (impl: () => Promise<void>) => {
        commitImpl = impl;
      },
      reset: () => {
        verifyIdToken.mockClear();
        verifyIdToken.mockResolvedValue({ uid: 'user-1' });
        generateContent.mockClear();
        generateContent.mockResolvedValue({ text: '' });
        getDb.mockClear();
        getAdminAuth.mockClear();
        GoogleGenAI.mockClear();
        batchCalls.length = 0;
        incidentIdCounter = 0;
        commitImpl = async () => {};
      },
    },
  };
});

vi.mock('../shared/admin-init.js', () => ({
  getDb: state.getDb,
  getAdminAuth: state.getAdminAuth,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: state.GoogleGenAI,
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    ARRAY: 'ARRAY',
    NUMBER: 'NUMBER',
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => '<!doctype html><html><head><title>Legacy Smelter</title></head><body><div id="root"></div></body></html>'),
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

async function importServer(): Promise<ServerModule> {
  vi.resetModules();
  process.env.VITE_APP_URL = 'https://legacy-smelter.test';
  process.env.GEMINI_API_KEY = 'test-key';
  // @ts-expect-error server.js is intentionally plain JS runtime code.
  return import('../server.js') as Promise<ServerModule>;
}

describe('POST /api/analyze integration', () => {
  let serverModule: ServerModule | null = null;

  beforeEach(() => {
    state.reset();
  });

  afterEach(() => {
    serverModule?.stopRateLimitCleanupIntervalForTests();
    serverModule = null;
  });

  it('returns analysis and persists incident + global_stats in a single batch commit', async () => {
    state.generateContent.mockResolvedValue({ text: buildGeminiResponseText() });
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        incidentId: 'incident-1',
        pixelCount: 1,
        legacyInfraClass: 'Artifact Node',
      }),
    );

    expect(state.verifyIdToken).toHaveBeenCalledWith('good-token');
    expect(state.generateContent).toHaveBeenCalledTimes(1);

    expect(state.batchCalls).toHaveLength(2);

    expect(state.batchCalls[0]).toEqual(
      expect.objectContaining({
        ref: { id: 'incident-1', path: 'incident_logs/incident-1' },
        payload: expect.objectContaining({
          uid: 'user-1',
          breach_count: 0,
          escalation_count: 0,
          sanction_count: 0,
          impact_score: 0,
          sanctioned: false,
          sanction_rationale: null,
        }),
      }),
    );

    expect(state.batchCalls[1]).toEqual(
      expect.objectContaining({
        ref: { id: 'main', path: 'global_stats/main' },
        payload: expect.objectContaining({ total_pixels_melted: expect.any(Object) }),
        options: { merge: true },
      }),
    );
  });

  it('rejects invalid auth tokens before analysis and writes', async () => {
    state.verifyIdToken.mockRejectedValue(new Error('invalid token'));
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer bad-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('Invalid or expired ID token');
    expect(state.generateContent).not.toHaveBeenCalled();
    expect(state.batchCalls).toHaveLength(0);
  });

  it('returns 502 when batch commit fails and does not return partial success', async () => {
    state.generateContent.mockResolvedValue({ text: buildGeminiResponseText() });
    state.setCommitImpl(async () => {
      throw new Error('firestore commit failed');
    });

    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(502);
    expect(response.body.error).toContain('Archive write failed');
    expect(state.batchCalls).toHaveLength(2);
    expect(response.body.incidentId).toBeUndefined();
  });
});

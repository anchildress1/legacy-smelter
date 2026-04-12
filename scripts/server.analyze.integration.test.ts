// @vitest-environment node
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6mF7sAAAAASUVORK5CYII=';

// Hoisted once so the oversize-payload test below does not allocate a
// ~9MB string on every run. `MAX_BASE64_LENGTH` is fixed at 9 * 1024 * 1024
// in server.js; the `+ 4` pads just past the boundary so the handler's
// `> MAX_BASE64_LENGTH` check fires.
const OVERSIZE_BASE64 = 'A'.repeat(9 * 1024 * 1024 + 4);

// Tests below mutate process.env — API_RATE_LIMIT_WINDOW_MS,
// API_RATE_LIMIT_MAX_REQUESTS, GEMINI_API_KEY, VITE_APP_URL. Without a
// snapshot/restore, other suites that share a Vitest worker can read
// these values and behave unexpectedly. Capture the original values once
// so the `afterAll` can put the environment back exactly how it started.
const ENV_KEYS_MUTATED = [
  'VITE_APP_URL',
  'GEMINI_API_KEY',
  'API_RATE_LIMIT_WINDOW_MS',
  'API_RATE_LIMIT_MAX_REQUESTS',
  'API_RATE_LIMIT_MAX_BUCKETS',
] as const;
const ENV_SNAPSHOT: Record<string, string | undefined> = {};

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
  getRateLimitBucketsForTests: () => Map<
    string,
    { windowStart: number; count: number }
  >;
}

function buildGeminiResponseText() {
  return JSON.stringify({
    legacy_infra_class: 'Artifact Node',
    diagnosis: 'Critical mismatch detected',
    dominant_hex_colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'],
    chromatic_profile: 'Thermal Beige',
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

async function importServer(overrides: Record<string, string | undefined> = {}): Promise<ServerModule> {
  vi.resetModules();
  process.env.VITE_APP_URL = 'https://legacy-smelter.test';
  process.env.GEMINI_API_KEY = 'test-key';
  // Default the rate-limit window wide enough that tests can hit the
  // cap without racing the clock; individual tests can shrink or enlarge
  // the cap via overrides.
  process.env.API_RATE_LIMIT_WINDOW_MS = '600000';
  process.env.API_RATE_LIMIT_MAX_REQUESTS = '12';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // @ts-expect-error server.js is intentionally plain JS runtime code.
  return import('../server.js') as Promise<ServerModule>;
}

describe('POST /api/analyze integration', () => {
  let serverModule: ServerModule | null = null;

  async function bootAnalyzeRequest({
    envOverrides = {},
    authorization = 'Bearer good-token',
    contentType = 'application/json',
    body = { image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' },
  }: {
    envOverrides?: Record<string, string | undefined>;
    authorization?: string | null;
    contentType?: string;
    body?: string | Record<string, unknown>;
  } = {}) {
    serverModule = await importServer(envOverrides);
    serverModule.resetAnalyzeRateLimitStateForTests();

    let req = request(serverModule.app).post('/api/analyze');
    if (authorization !== null) {
      req = req.set('Authorization', authorization);
    }
    if (contentType) {
      req = req.set('Content-Type', contentType);
    }
    return req.send(body);
  }

  // Shared assertion for the "Gemini upstream is unusable" family of
  // failures: the handler should short-circuit with 502 "Analysis failed"
  // and must NOT have enqueued any batch writes. Each caller sets up the
  // upstream mock differently (throw, empty text, malformed JSON, schema
  // miss, etc.), then delegates to this helper so the response-shape
  // invariant is pinned in one place.
  async function expectAnalysisFailure502(): Promise<void> {
    const response = await bootAnalyzeRequest();
    expect(response.status).toBe(502);
    expect(response.body.error).toContain('Analysis failed');
    expect(state.batchCalls).toHaveLength(0);
  }

  beforeAll(() => {
    for (const key of ENV_KEYS_MUTATED) {
      ENV_SNAPSHOT[key] = process.env[key];
    }
  });

  afterAll(() => {
    // Restore env exactly — set values back, or delete keys that were
    // unset before this suite ran. Leaving mutated values behind leaks
    // into other suites sharing the same Vitest worker.
    for (const key of ENV_KEYS_MUTATED) {
      const original = ENV_SNAPSHOT[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

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

  it('returns 429 with Retry-After once per-IP rate limit is exceeded', async () => {
    // Build a server with a tiny cap so the test can hit the threshold
    // without the per-request overhead of the default 12. Both env vars
    // are pinned explicitly so the upper-bound assertion on Retry-After
    // below is computed against a known window size.
    const WINDOW_MS = 600_000;
    const WINDOW_SECONDS = WINDOW_MS / 1000;
    state.generateContent.mockResolvedValue({ text: buildGeminiResponseText() });
    serverModule = await importServer({
      API_RATE_LIMIT_MAX_REQUESTS: '2',
      API_RATE_LIMIT_WINDOW_MS: String(WINDOW_MS),
    });
    // IMPORTANT: the three requests below intentionally share a single
    // rate-limit bucket. Do NOT call `resetAnalyzeRateLimitStateForTests`
    // between them — that is the exact shim that masks the limiter in
    // other tests. The server module is imported once per `it` block
    // via `importServer`, so the bucket is fresh at the start of this
    // test but carries state across the three calls within it.

    const makeRequest = () =>
      request(serverModule!.app)
        .post('/api/analyze')
        .set('Authorization', 'Bearer good-token')
        .set('Content-Type', 'application/json')
        .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    const first = await makeRequest();
    expect(first.status).toBe(200);

    const second = await makeRequest();
    expect(second.status).toBe(200);

    const third = await makeRequest();
    expect(third.status).toBe(429);
    expect(third.body.error).toContain('Rate limit exceeded');
    expect(third.headers['retry-after']).toBeDefined();
    const retryAfter = Number.parseInt(third.headers['retry-after'], 10);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    // Upper bound: Retry-After must never exceed the configured window.
    // A bogus header (e.g. NaN floor, negative-then-coerced, window in ms
    // instead of seconds) would trip this assertion before a real client
    // wasted minutes waiting for a reset that never comes.
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_SECONDS);
    // The limiter short-circuits before auth or analysis so the Gemini
    // client is never invoked on the 429 path.
    expect(state.generateContent).toHaveBeenCalledTimes(2);
  });

  it('rejects missing Authorization header before touching Gemini or Firestore', async () => {
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('Missing Authorization header');
    expect(state.generateContent).not.toHaveBeenCalled();
    expect(state.batchCalls).toHaveLength(0);
  });

  it('rejects requests missing required body fields (image, mimeType) with 400', async () => {
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const missingMimeType = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64 });

    expect(missingMimeType.status).toBe(400);
    expect(missingMimeType.body.error).toContain('Request must include');

    const missingImage = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ mimeType: 'image/png' });

    expect(missingImage.status).toBe(400);

    const wrongTypes = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: 42, mimeType: 99 });

    expect(wrongTypes.status).toBe(400);

    expect(state.generateContent).not.toHaveBeenCalled();
    expect(state.batchCalls).toHaveLength(0);
  });

  it('rejects unsupported mime types with 400', async () => {
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/bmp' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Unsupported image type');
    expect(state.generateContent).not.toHaveBeenCalled();
  });

  it('rejects oversized base64 payloads with 413', async () => {
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    // OVERSIZE_BASE64 is hoisted to module scope (9MB + 4 bytes) so the
    // string is allocated once for the whole suite instead of on every
    // test run. It is a valid base64 "A" repeat larger than
    // MAX_BASE64_LENGTH (9 * 1024 * 1024) but inside the 10MB JSON body
    // parser limit, so the handler rejects it at the length check before
    // decoding.
    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: OVERSIZE_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(413);
    expect(response.body.error).toContain('Image too large');
    expect(state.generateContent).not.toHaveBeenCalled();
  });

  it('rejects non-JSON content types on /api routes with 415', async () => {
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'text/plain')
      .send('raw body');

    expect(response.status).toBe(415);
    expect(response.body.error).toContain('Content-Type must be application/json');
  });

  it('returns 400 when the image payload fails dimension parsing', async () => {
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    // 'AAAA' decodes to 3 null bytes — valid base64, not a valid image.
    // `imageSize` throws, and the handler surfaces 400 "Invalid image payload".
    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: 'AAAA', mimeType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid image payload');
    expect(state.generateContent).not.toHaveBeenCalled();
  });

  it('returns 502 when Gemini throws during analysis', async () => {
    state.generateContent.mockRejectedValue(new Error('gemini network down'));
    await expectAnalysisFailure502();
  });

  it('returns 502 when Gemini returns an empty response', async () => {
    state.generateContent.mockResolvedValue({ text: '' });
    await expectAnalysisFailure502();
  });

  it('returns 502 when Gemini returns malformed JSON', async () => {
    state.generateContent.mockResolvedValue({ text: 'not json at all' });
    await expectAnalysisFailure502();
  });

  it('returns 502 when Gemini response is missing required fields', async () => {
    const partial = JSON.parse(buildGeminiResponseText()) as Record<string, unknown>;
    delete partial.legacy_infra_class;
    state.generateContent.mockResolvedValue({ text: JSON.stringify(partial) });
    await expectAnalysisFailure502();
  });

  it('returns 502 when Gemini subject_box is not a 4-number array', async () => {
    const wrongBox = JSON.parse(buildGeminiResponseText()) as Record<string, unknown>;
    wrongBox.subject_box = [0, 0, 'nope', 100];
    state.generateContent.mockResolvedValue({ text: JSON.stringify(wrongBox) });
    await expectAnalysisFailure502();
  });

  it('accepts finite non-integer floats in subject_box and persists them verbatim', async () => {
    // The positive path only asserted integer box coordinates. Gemini is
    // free to return any finite numbers, so a parser that silently
    // coerced to ints (Math.floor, |0, parseInt) would drop precision
    // with no signal. Pin the invariant that finite floats flow through
    // unchanged.
    const floatBox = JSON.parse(buildGeminiResponseText()) as Record<string, unknown>;
    floatBox.subject_box = [0.5, 0.25, 999.75, 1000];
    state.generateContent.mockResolvedValue({ text: JSON.stringify(floatBox) });

    const response = await bootAnalyzeRequest();

    expect(response.status).toBe(200);
    expect(state.batchCalls).toHaveLength(2);

    expect(state.batchCalls[0]?.payload).toEqual(
      expect.objectContaining({
        subject_box_ymin: 0.5,
        subject_box_xmin: 0.25,
        subject_box_ymax: 999.75,
        subject_box_xmax: 1000,
      }),
    );
  });

  it('rejects Authorization headers that do not use the Bearer scheme with 401', async () => {
    // `requireFirebaseAuth` checks `startsWith('Bearer ')` — a Basic auth
    // header, a bare token, or any non-Bearer scheme must be rejected
    // before touching the Firebase verifyIdToken path so that unauth'd
    // probes cannot exercise the token verifier as an oracle.
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const basicAuth = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(basicAuth.status).toBe(401);
    expect(basicAuth.body.error).toContain('Missing Authorization header');
    expect(state.verifyIdToken).not.toHaveBeenCalled();
    expect(state.generateContent).not.toHaveBeenCalled();
  });

  // NOTE: the `Empty bearer token` branch of requireFirebaseAuth is
  // defensive code that cannot be reached via real HTTP transport.
  // Per RFC 7230 §3.2.4, HTTP header field values are surrounded by
  // OWS (optional whitespace) that MUST be stripped by any compliant
  // client or server before the value is interpreted. Node's `http`
  // module and supertest both strip trailing whitespace, so a test
  // that sends `Authorization: Bearer ` arrives at the handler as
  // `Bearer` (no trailing space), which fails the earlier
  // `startsWith('Bearer ')` check and returns "Missing Authorization
  // header" instead. The only way to exercise the "Empty bearer
  // token" line is to call the middleware function directly with a
  // hand-crafted req object — which would bypass every other layer
  // of the Express stack and provide no additional integration
  // signal. Leaving this branch uncovered is the correct trade-off:
  // it cannot be reached by a real client and the surrounding code
  // (the `startsWith` check) is exercised by the Basic-auth test
  // above.

  it('returns 400 when the JSON body is malformed via the entity.parse.failed middleware', async () => {
    // The error middleware at the bottom of /api routes maps Express's
    // `entity.parse.failed` to 400 "Malformed JSON body". This is the
    // only place the API surfaces a parser error as a typed response —
    // without it, the request would escape to the default 500 handler
    // and leak internal error shape to clients.
    serverModule = await importServer();
    serverModule.resetAnalyzeRateLimitStateForTests();

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send('{ this is : not, json');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Malformed JSON body');
    expect(state.generateContent).not.toHaveBeenCalled();
    expect(state.batchCalls).toHaveLength(0);
  });

  it('resets the rate-limit bucket after the window elapses', async () => {
    // The limiter resets the bucket when `now - windowStart >= window`.
    // Setting a tiny window and waiting past it must let a previously-
    // capped client through again. A regression that left stale buckets
    // in place would silently extend the 429 state past the advertised
    // Retry-After.
    state.generateContent.mockResolvedValue({ text: buildGeminiResponseText() });
    serverModule = await importServer({
      API_RATE_LIMIT_MAX_REQUESTS: '1',
      API_RATE_LIMIT_WINDOW_MS: '50',
    });

    const first = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });
    expect(first.status).toBe(200);

    const second = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });
    expect(second.status).toBe(429);

    // Wait past the configured window so the limiter resets the bucket
    // on the next request. Use a real delay (not fake timers) because
    // the limiter reads `Date.now()` directly and we want to exercise
    // the real code path.
    await new Promise((resolve) => setTimeout(resolve, 80));

    const third = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });
    expect(third.status).toBe(200);
  });

  it('returns 503 when the rate-limit bucket map is full and a new IP arrives', async () => {
    // `API_RATE_LIMIT_MAX_BUCKETS` caps the number of concurrent
    // rate-limit keys to prevent unbounded memory growth under a
    // high-cardinality flood (e.g. a bot that rotates IPs on every
    // request). With the cap pinned at 1 and a single foreign IP
    // already seeded, the next distinct IP must be rejected with 503
    // BEFORE reaching the main bucket counting logic.
    //
    // Production deploys leave `API_RATE_LIMIT_MAX_BUCKETS` unset and
    // inherit the 10_000 default; the env override exists solely so
    // this test can exercise the guard without forging 10k IPs.
    state.generateContent.mockResolvedValue({ text: buildGeminiResponseText() });
    serverModule = await importServer({
      API_RATE_LIMIT_MAX_BUCKETS: '1',
      API_RATE_LIMIT_MAX_REQUESTS: '100',
    });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Seed a foreign "IP" (opaque bucket key) into the rate-limit map so
    // the supertest request from 127.0.0.1 presents as a NEW key and trips
    // the capacity check at the top of `rateLimitAnalyzeRoute`. The key is
    // never dialed or resolved — it only has to be distinct from
    // `::ffff:127.0.0.1` / `127.0.0.1` so the bucket count saturates.
    const buckets = serverModule.getRateLimitBucketsForTests();
    const seededBucketKey = ['foreign', 'test', 'ip'].join('-');
    buckets.set(seededBucketKey, { windowStart: Date.now(), count: 1 });

    const response = await request(serverModule.app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer good-token')
      .set('Content-Type', 'application/json')
      .send({ image: ONE_BY_ONE_PNG_BASE64, mimeType: 'image/png' });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain('Server busy');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[server][ERR_RATE_LIMIT_BUCKET_FULL]'),
      1,
      expect.any(String),
    );
    // Auth and analysis must be short-circuited before they run.
    expect(state.verifyIdToken).not.toHaveBeenCalled();
    expect(state.generateContent).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

});

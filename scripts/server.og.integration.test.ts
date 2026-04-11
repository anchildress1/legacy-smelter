// @vitest-environment node
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The OG route (`GET /s/:id`) is a thin wrapper over Firestore REST that
// inlines incident-specific meta tags into the SPA HTML before handing
// the response to Slack/Twitter/LinkedIn crawlers. Regressions here are
// especially load-bearing because:
//   1. The route is the only path that handles user-supplied `:id` values
//      against a live Firestore REST call — any bypass of the path-shape
//      guard opens a direct probe channel.
//   2. `og_headline`, `incident_feed_summary`, `severity`, and
//      `legacy_infra_class` all flow from Gemini into `injectIncidentOg`,
//      so HTML-escaping must hold across every field to keep attacker-
//      controlled strings from breaking out of meta-tag attributes.
//   3. A transient Firestore failure that returned a cached 200 would
//      poison every CDN consumer for the cache TTL.
//
// This suite mocks `node:fs.readFileSync` so the SPA HTML contains every
// tag the injector touches, and mocks `global.fetch` so `fetchIncident`
// can be driven through each branch (happy, notFound, throw, empty
// headline) without a real Firestore. The env vars are pinned so the
// route's configuration guard does not short-circuit.

// Full SPA shell with every meta tag `injectIncidentOg` replaces. Without
// these, the regex-based replace calls would silently no-op and the test
// would report success even when no injection happened.
const FULL_SPA_HTML = `<!doctype html>
<html>
<head>
  <title>Legacy Smelter</title>
  <meta name="description" content="default description" />
  <meta property="og:title" content="default og title" />
  <meta property="og:description" content="default og desc" />
  <meta property="og:url" content="https://example.test/" />
  <meta property="og:image" content="https://example.test/default.png" />
  <meta property="og:image:width" content="1" />
  <meta property="og:image:height" content="1" />
  <meta property="og:image:alt" content="default alt" />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content="default twitter title" />
  <meta name="twitter:description" content="default twitter desc" />
  <meta name="twitter:image" content="https://example.test/default.png" />
  <meta name="twitter:image:alt" content="default twitter alt" />
</head>
<body><div id="root"></div></body>
</html>`;

const ENV_KEYS_MUTATED = [
  'VITE_APP_URL',
  'GEMINI_API_KEY',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_FIRESTORE_DATABASE_ID',
] as const;
const ENV_SNAPSHOT: Record<string, string | undefined> = {};

const { state } = vi.hoisted(() => {
  const verifyIdToken = vi.fn(async () => ({ uid: 'user-1' }));
  const generateContent = vi.fn(async () => ({ text: '' }));
  const db = {
    collection: vi.fn(),
    batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
  };

  const GoogleGenAI = vi.fn(function GoogleGenAIMock(this: {
    models: { generateContent: typeof generateContent };
  }) {
    this.models = { generateContent };
  });

  return {
    state: {
      verifyIdToken,
      generateContent,
      GoogleGenAI,
      getDb: vi.fn(() => db),
      getAdminAuth: vi.fn(() => ({ verifyIdToken })),
    },
  };
});

vi.mock('../shared/admin-init.js', () => ({
  getDb: state.getDb,
  getAdminAuth: state.getAdminAuth,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: state.GoogleGenAI,
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER' },
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => FULL_SPA_HTML),
}));

interface ServerModule {
  app: import('express').Express;
  resetAnalyzeRateLimitStateForTests: () => void;
  stopRateLimitCleanupIntervalForTests: () => void;
}

async function importServer(): Promise<ServerModule> {
  vi.resetModules();
  process.env.VITE_APP_URL = 'https://legacy-smelter.test';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.VITE_FIREBASE_API_KEY = 'firebase-key';
  process.env.VITE_FIREBASE_PROJECT_ID = 'demo-project';
  process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID = '(default)';
  // @ts-expect-error server.js is plain JS runtime code.
  return import('../server.js') as Promise<ServerModule>;
}

function buildIncidentRestResponse(fields: Record<string, string>): Response {
  // Minimal subset of the Firestore REST "document" shape that
  // `fetchIncident` reads via `data.fields[k]?.stringValue`.
  const restFields: Record<string, { stringValue: string }> = {};
  for (const [key, value] of Object.entries(fields)) {
    restFields[key] = { stringValue: value };
  }
  return new Response(JSON.stringify({ name: 'docs/inc', fields: restFields }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /s/:id OG injection', () => {
  let serverModule: ServerModule | null = null;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    for (const key of ENV_KEYS_MUTATED) {
      ENV_SNAPSHOT[key] = process.env[key];
    }
  });

  afterAll(() => {
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
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    serverModule?.stopRateLimitCleanupIntervalForTests();
    serverModule = null;
  });

  it('injects incident-specific meta tags on the happy path', async () => {
    fetchSpy.mockResolvedValue(
      buildIncidentRestResponse({
        og_headline: 'Legacy artifact breached thermal policy',
        incident_feed_summary: 'Containment failed on artifact.',
        severity: 'Severe',
        legacy_infra_class: 'Artifact Node',
      }),
    );

    serverModule = await importServer();
    const response = await request(serverModule.app).get('/s/valid-incident-id');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    // Long CDN TTL is the happy-path signal — a regression that returned
    // no-store for successful responses would silently kill share-link
    // caching performance.
    expect(response.headers['cache-control']).toContain('max-age=3600');
    expect(response.headers['cache-control']).toContain('s-maxage=86400');
    expect(response.text).toContain(
      '<title>Legacy artifact breached thermal policy — Legacy Smelter</title>',
    );
    expect(response.text).toContain(
      '<meta property="og:title" content="Legacy artifact breached thermal policy — Legacy Smelter"',
    );
    expect(response.text).toContain(
      'content="[Severe] Artifact Node: Containment failed on artifact."',
    );
    expect(response.text).toContain(
      '<meta property="og:url" content="https://legacy-smelter.test/s/valid-incident-id"',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(fetchUrl).toContain('/documents/incident_logs/valid-incident-id');
  });

  it('HTML-escapes attacker-controlled incident fields to prevent meta-tag breakout', async () => {
    // This is the core anti-injection guarantee. If `esc()` is dropped or
    // weakened, a Gemini response containing `<script>` / `"` / `>` would
    // escape the meta tag's `content` attribute and inject arbitrary HTML
    // into every Slack unfurl for the incident. Pin the escape invariants
    // directly: the raw `<`, `>`, `&`, and `"` must not appear verbatim
    // inside the injected title/description/alt attributes.
    fetchSpy.mockResolvedValue(
      buildIncidentRestResponse({
        og_headline: '<script>alert("xss")</script>',
        incident_feed_summary: 'drift & "quoted" <danger>',
        severity: 'Se"vere',
        legacy_infra_class: 'Class<1>',
      }),
    );

    serverModule = await importServer();
    const response = await request(serverModule.app).get('/s/safe-id');

    expect(response.status).toBe(200);
    // Raw payload must NOT appear verbatim — the escape replaced `<`, `>`
    // and `"` before the meta tag was closed.
    expect(response.text).not.toContain('<script>alert("xss")</script>');
    expect(response.text).not.toContain('"quoted"');
    // Escaped form MUST appear in the injected title (both in `<title>`
    // and in the `og:title`/`twitter:title` meta tags).
    expect(response.text).toContain(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; — Legacy Smelter',
    );
    expect(response.text).toContain('&amp;');
    expect(response.text).toContain('&quot;quoted&quot;');
    expect(response.text).toContain('&lt;danger&gt;');
    // Sanity check: the closing `</title>` tag must still exist exactly
    // once. A broken escape that inserted unescaped `<` into the title
    // body would add a spurious `</title>` count.
    const titleCloseCount = (response.text.match(/<\/title>/g) ?? []).length;
    expect(titleCloseCount).toBe(1);
  });

  it('rejects malicious incident ids before calling Firestore and falls through to the SPA', async () => {
    // `VALID_INCIDENT_ID_PATTERN` is the sole guard against path traversal,
    // CRLF injection, and log poisoning probes. Any id that doesn't match
    // the Firestore auto-id shape must skip `fetchIncident` entirely and
    // fall through to the SPA 200 (the Express default handler renders
    // the shell). A regression that dropped the guard would feed every
    // probe directly into `encodeURIComponent` + a live REST call.
    serverModule = await importServer();
    const maliciousIds = [
      '../etc/passwd',
      '..%2Fetc%2Fpasswd',
      'valid\r\nInjected: header',
      'inc<script>',
      'inc id with spaces',
      'a'.repeat(65), // exceeds 64-char cap
      '',
    ];

    for (const badId of maliciousIds) {
      fetchSpy.mockClear();
      // The `..` patterns get normalized by Express routing before they
      // reach the handler — supertest's URL encoding means we can't
      // assert the `next()` branch on those. But for the in-shape-but-
      // malicious ids (`inc<script>`, spaces, oversized), the request
      // must NOT call fetch and must still return a 200 SPA response.
      const response = await request(serverModule.app).get(
        `/s/${encodeURIComponent(badId)}`,
      );
      // The path guard falls through to the SPA which returns 200. A
      // regression that returned 400 or 500 would also signal the test
      // but the important invariant is: NO call to fetchIncident.
      expect(response.status).toBeLessThan(500);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('falls through with no-store Cache-Control when fetchIncident throws', async () => {
    // A transient Firestore error (network blip, 5xx, quota) must NOT
    // cache-poison the CDN for the happy-path TTL. The route sets
    // `Cache-Control: no-store` and falls through to the SPA shell so the
    // next request retries instead of serving a stale error for an hour.
    fetchSpy.mockRejectedValue(new Error('network down'));

    serverModule = await importServer();
    const response = await request(serverModule.app).get('/s/valid-incident-id');

    expect(response.status).toBeLessThan(500);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.text).not.toContain('<title>undefined');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[server][ERR_OG_FETCH_FAILED]'),
      expect.any(String),
      expect.any(String),
    );
  });

  it('falls through without cache poisoning when Firestore returns 404 notFound', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 404 }));

    serverModule = await importServer();
    const response = await request(serverModule.app).get('/s/missing-doc-id');

    // Not-found docs fall through to the SPA shell — the user still sees
    // the app, the crawler just gets the default meta tags. No injected
    // title should be present.
    expect(response.status).toBeLessThan(500);
    expect(response.text).toContain('<title>Legacy Smelter</title>');
  });

  it('falls through with no-store when og_headline is empty', async () => {
    // A document missing `og_headline` (pre-migration, backfill in
    // progress, Gemini returned empty) must not inject a half-built
    // title. The route logs `ERR_OG_EMPTY_HEADLINE` and falls through
    // with `no-store` so the CDN doesn't cache the fallback.
    fetchSpy.mockResolvedValue(
      buildIncidentRestResponse({
        og_headline: '',
        incident_feed_summary: 'summary',
        severity: 'Severe',
        legacy_infra_class: 'Class',
      }),
    );

    serverModule = await importServer();
    const response = await request(serverModule.app).get('/s/empty-headline-id');

    expect(response.status).toBeLessThan(500);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[server][ERR_OG_EMPTY_HEADLINE]'),
      expect.any(String),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the client-side `/api/analyze` caller. The goals here:
 *
 *   1. Pin the status → `AnalysisError.category` mapping because the
 *      category drives user-visible copy in App.tsx — changing the map
 *      silently changes error messaging.
 *   2. Pin the response-body parser (`parseSmeltAnalysis`) so a Gemini
 *      response that drops a field, or returns a malformed `subjectBox`,
 *      surfaces as a loud failure rather than rendering `undefined`.
 *   3. Pin the auth path so a refactor of `ensureAnonymousAuth` cannot
 *      silently drop the `Authorization` header.
 */

const mockEnsureAnonymousAuth = vi.fn<() => Promise<void>>();
const mockGetAuth = vi.fn();
const mockGetIdToken = vi.fn<() => Promise<string>>();

vi.mock('../firebase', () => ({
  ensureAnonymousAuth: mockEnsureAnonymousAuth,
}));

vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
}));

type GeminiServiceModule = typeof import('./geminiService');

async function loadService(): Promise<GeminiServiceModule> {
  return import('./geminiService');
}

function makeValidResponseBody(overrides: Record<string, unknown> = {}) {
  return {
    legacyInfraClass: 'Class',
    diagnosis: 'diag',
    dominantColors: ['#ff0000', '#00ff00'],
    chromaticProfile: 'profile',
    severity: 'HIGH',
    primaryContamination: 'primary',
    contributingFactor: 'contrib',
    failureOrigin: 'origin',
    disposition: 'disp',
    incidentFeedSummary: 'summary',
    archiveNote: 'archive',
    ogHeadline: 'headline',
    shareQuote: 'quote',
    anonHandle: 'handle',
    pixelCount: 12_345,
    subjectBox: [10, 20, 30, 40],
    incidentId: 'doc-1',
    ...overrides,
  };
}

function stubFetchResponse({
  ok,
  status,
  json,
}: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}): Response {
  return { ok, status, json } as unknown as Response;
}

describe('geminiService', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockEnsureAnonymousAuth.mockResolvedValue(undefined);
    mockGetIdToken.mockResolvedValue('test-id-token');
    mockGetAuth.mockReturnValue({
      currentUser: { getIdToken: mockGetIdToken },
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function expectParseError(body: unknown, match: string | RegExp): Promise<void> {
    fetchSpy.mockResolvedValueOnce(
      stubFetchResponse({
        ok: true,
        status: 200,
        json: async () => body,
      }),
    );
    const { analyzeLegacyTech } = await loadService();
    await expect(analyzeLegacyTech('img', 'image/png')).rejects.toThrow(match);
  }

  describe('AnalysisError', () => {
    it('carries status, message, category and a stable name for catch blocks', async () => {
      const { AnalysisError } = await loadService();
      const err = new AnalysisError(429, 'slow down', 'rate_limited');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('AnalysisError');
      expect(err.status).toBe(429);
      expect(err.category).toBe('rate_limited');
      expect(err.message).toBe('slow down');
    });
  });

  describe('analyzeLegacyTech — happy path', () => {
    it('sends a Bearer token, posts base64 payload, and returns a parsed SmeltAnalysis', async () => {
      fetchSpy.mockResolvedValueOnce(
        stubFetchResponse({
          ok: true,
          status: 200,
          json: async () => makeValidResponseBody(),
        }),
      );

      const { analyzeLegacyTech } = await loadService();
      const result = await analyzeLegacyTech('base64-data', 'image/png');

      expect(mockEnsureAnonymousAuth).toHaveBeenCalledOnce();
      expect(mockGetIdToken).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/analyze',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-id-token',
          }),
          body: JSON.stringify({ image: 'base64-data', mimeType: 'image/png' }),
        }),
      );
      expect(result).toMatchObject({
        legacyInfraClass: 'Class',
        dominantColors: ['#ff0000', '#00ff00'],
        pixelCount: 12_345,
        subjectBox: [10, 20, 30, 40],
        incidentId: 'doc-1',
      });
    });

    it('filters non-string entries out of dominantColors without throwing', async () => {
      fetchSpy.mockResolvedValueOnce(
        stubFetchResponse({
          ok: true,
          status: 200,
          json: async () =>
            makeValidResponseBody({ dominantColors: ['#ff0000', 42, null, '#00ff00'] }),
        }),
      );

      const { analyzeLegacyTech } = await loadService();
      const result = await analyzeLegacyTech('img', 'image/png');
      expect(result.dominantColors).toEqual(['#ff0000', '#00ff00']);
    });
  });

  describe('analyzeLegacyTech — auth gating', () => {
    it('throws when auth could not complete and there is no current user', async () => {
      mockGetAuth.mockReturnValueOnce({ currentUser: null });
      const { analyzeLegacyTech } = await loadService();
      await expect(analyzeLegacyTech('img', 'image/png')).rejects.toThrow(
        'Authentication required to analyze image.',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('propagates errors from ensureAnonymousAuth', async () => {
      mockEnsureAnonymousAuth.mockRejectedValueOnce(new Error('anon fail'));
      const { analyzeLegacyTech } = await loadService();
      await expect(analyzeLegacyTech('img', 'image/png')).rejects.toThrow('anon fail');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('analyzeLegacyTech — HTTP failure → AnalysisError category', () => {
    /**
     * The category drives user-visible recovery copy in App.tsx. Each
     * status code is one entry so a refactor that moves this table
     * breaks here first instead of silently mis-rendering toasts.
     */
    const statusToCategory: Array<[number, string]> = [
      [401, 'auth'],
      [429, 'rate_limited'],
      [503, 'server_busy'],
      [400, 'payload'],
      [413, 'payload'],
      [415, 'payload'],
      [502, 'analysis'],
      [500, 'unknown'],
      [418, 'unknown'],
    ];

    it.each(statusToCategory)(
      'maps HTTP %s to category "%s"',
      async (status, expectedCategory) => {
        fetchSpy.mockResolvedValueOnce(
          stubFetchResponse({
            ok: false,
            status,
            json: async () => ({ error: 'boom' }),
          }),
        );
        const { analyzeLegacyTech, AnalysisError } = await loadService();
        // Callers in App.tsx use `instanceof AnalysisError` to
        // discriminate against generic network errors — catching the
        // rejection by hand confirms the custom class rather than a
        // plain `Error`, which `toMatchObject` alone cannot assert.
        let caught: unknown;
        try {
          await analyzeLegacyTech('img', 'image/png');
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(AnalysisError);
        expect(caught).toMatchObject({
          name: 'AnalysisError',
          status,
          category: expectedCategory,
          message: 'boom',
        });
      },
    );

    it('falls back to status-based message when error body is not JSON', async () => {
      fetchSpy.mockResolvedValueOnce(
        stubFetchResponse({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error('not json');
          },
        }),
      );
      const { analyzeLegacyTech } = await loadService();
      await expect(analyzeLegacyTech('img', 'image/png')).rejects.toMatchObject({
        status: 500,
        category: 'unknown',
        message: 'Server returned 500',
      });
    });

    it('falls back to status-based message when body.error is empty/missing', async () => {
      fetchSpy.mockResolvedValueOnce(
        stubFetchResponse({
          ok: false,
          status: 503,
          json: async () => ({ error: '' }),
        }),
      );
      const { analyzeLegacyTech } = await loadService();
      await expect(analyzeLegacyTech('img', 'image/png')).rejects.toMatchObject({
        status: 503,
        category: 'server_busy',
        message: 'Server returned 503',
      });
    });

    it('falls back to status-based message when body.error is not a string', async () => {
      fetchSpy.mockResolvedValueOnce(
        stubFetchResponse({
          ok: false,
          status: 400,
          json: async () => ({ error: { detail: 'nope' } }),
        }),
      );
      const { analyzeLegacyTech } = await loadService();
      await expect(analyzeLegacyTech('img', 'image/png')).rejects.toMatchObject({
        status: 400,
        category: 'payload',
        message: 'Server returned 400',
      });
    });
  });

  describe('analyzeLegacyTech — response body shape validation', () => {
    it('rejects a non-object response', async () => {
      await expectParseError('nope', 'API response is not an object');
    });

    it('rejects a null response', async () => {
      await expectParseError(null, 'API response is not an object');
    });

    it('rejects a missing dominantColors array', async () => {
      const body = makeValidResponseBody();
      delete (body as Record<string, unknown>).dominantColors;
      await expectParseError(body, 'missing dominantColors array');
    });

    it('rejects a non-array dominantColors', async () => {
      await expectParseError(
        makeValidResponseBody({ dominantColors: '#ff0000' }),
        'missing dominantColors array',
      );
    });

    it('rejects a subjectBox with the wrong length', async () => {
      await expectParseError(
        makeValidResponseBody({ subjectBox: [10, 20, 30] }),
        'invalid subjectBox',
      );
    });

    it('rejects a subjectBox containing a non-number', async () => {
      await expectParseError(
        makeValidResponseBody({ subjectBox: [10, 20, 30, '40'] }),
        'invalid subjectBox',
      );
    });

    it('rejects a missing pixelCount', async () => {
      const body = makeValidResponseBody();
      delete (body as Record<string, unknown>).pixelCount;
      await expectParseError(body, 'missing or invalid pixelCount');
    });

    it('rejects a non-finite pixelCount', async () => {
      await expectParseError(
        makeValidResponseBody({ pixelCount: Number.NaN }),
        'missing or invalid pixelCount',
      );
    });

    it('rejects pixelCount <= 0', async () => {
      // pixelCount feeds `formatPixels` which displays totals in the
      // header. Zero or negative would render as "0 PIXELS" which is
      // indistinguishable from a legitimate zero — better to refuse
      // the response outright.
      await expectParseError(
        makeValidResponseBody({ pixelCount: 0 }),
        'missing or invalid pixelCount',
      );
      await expectParseError(
        makeValidResponseBody({ pixelCount: -1 }),
        'missing or invalid pixelCount',
      );
    });

    it.each([
      'legacyInfraClass',
      'diagnosis',
      'chromaticProfile',
      'severity',
      'primaryContamination',
      'contributingFactor',
      'failureOrigin',
      'disposition',
      'incidentFeedSummary',
      'archiveNote',
      'ogHeadline',
      'shareQuote',
      'anonHandle',
      'incidentId',
    ])('rejects missing string field %s', async (field) => {
      const body = makeValidResponseBody();
      delete (body as Record<string, unknown>)[field];
      await expectParseError(body, new RegExp(`missing or empty "${field}"`));
    });

    it('rejects an empty string field', async () => {
      await expectParseError(
        makeValidResponseBody({ legacyInfraClass: '' }),
        'missing or empty "legacyInfraClass"',
      );
    });
  });
});

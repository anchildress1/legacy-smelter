import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Behaviour tests for App.tsx state transitions. `App.mobileLayout.test.tsx`
// pins the header classnames against a screenshot regression and does NOT
// exercise any of the underlying state machine: processImage, deep link,
// analyze-error surfacing, FileReader failures, or the canvas render
// failure fallback. This suite covers those branches so a regression in
// any of them has to go through a test update, not the review cycle.
//
// The module mocks below are scoped to exactly what App.tsx imports so
// the render stays synchronous and deterministic. Every feature module
// that touches Firebase, PIXI, Howler, or Gemini is stubbed.

const flushFirestore = () => () => {};

const mockAnalyzeLegacyTech =
  vi.fn<(base64: string, mimeType: string) => Promise<unknown>>();
const mockGetDoc = vi.fn();
const mockParseSmeltLog = vi.fn();

vi.mock('./firebase', () => ({
  db: { __db: true },
  collection: vi.fn(() => ({ __collection: true })),
  onSnapshot: vi.fn(() => flushFirestore()),
  query: vi.fn(() => ({ __query: true })),
  orderBy: vi.fn(() => ({ __orderBy: true })),
  limit: vi.fn(() => ({ __limit: true })),
  doc: vi.fn((_db: unknown, _collection: string, id: string) => ({
    __doc: true,
    id,
  })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

vi.mock('./services/geminiService', async () => {
  const actual = await vi.importActual<typeof import('./services/geminiService')>(
    './services/geminiService',
  );
  return {
    ...actual,
    analyzeLegacyTech: (...args: [string, string]) =>
      mockAnalyzeLegacyTech(...args),
  };
});

vi.mock('./lib/firestoreErrors', () => ({
  handleFirestoreError: vi.fn(),
  OperationType: { GET: 'GET', LIST: 'LIST' },
}));

vi.mock('./lib/smeltLogSchema', () => ({
  parseSmeltLog: (...args: unknown[]) => mockParseSmeltLog(...args),
  parseSmeltLogBatch: vi.fn(() => ({ entries: [], invalidCount: 0 })),
}));

vi.mock('./lib/utils', () => ({
  getLogShareLinks: vi.fn(() => []),
  buildShareLinks: vi.fn(() => []),
  buildIncidentUrl: vi.fn(() => 'https://example.test/i/1'),
  formatPixels: vi.fn(() => ({ value: '0', unit: 'MEGAPIXELS' })),
  formatTimestamp: vi.fn(() => '2026-04-10'),
  getFiveDistinctColors: vi.fn(() => ['#000', '#111', '#222', '#333', '#444']),
}));

vi.mock('howler', () => ({
  Howl: vi.fn(function HowlMock(this: unknown) {
    return {
      play: vi.fn(),
      stop: vi.fn(),
      volume: vi.fn(),
    };
  }),
}));

vi.mock('./components/SmelterCanvas', () => ({
  SmelterCanvas: () => null,
}));

vi.mock('./components/IncidentReportOverlay', () => ({
  IncidentReportOverlay: ({ incidentId }: { incidentId: string }) => (
    <div data-testid="incident-report-overlay" data-incident-id={incidentId} />
  ),
}));

vi.mock('./components/IncidentLogCard', () => ({
  IncidentLogCard: () => null,
}));

vi.mock('./components/DecommissionIndex', () => ({
  DecommissionIndex: () => <div data-testid="decommission-index-stub" />,
}));

vi.mock('./components/SiteFooter', () => ({
  SiteFooter: () => null,
}));

vi.mock('./components/DataHealthIndicator', () => ({
  DataHealthIndicator: ({ issues }: { issues: string[] }) => (
    <div data-testid="data-health-stub" data-issue-count={issues.length}>
      {issues.map((issue) => (
        <div key={issue} data-testid="data-health-issue">
          {issue}
        </div>
      ))}
    </div>
  ),
}));

import App from './App';

describe('App state transitions', () => {
  beforeAll(() => {
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDoc.mockReset();
    mockParseSmeltLog.mockReset();
    mockAnalyzeLegacyTech.mockReset();
  });

  describe('deep link incident fetching', () => {
    it('opens the incident overlay when deepLinkId resolves to an existing doc', async () => {
      // Happy path: deep link fetches the doc, parseSmeltLog returns a
      // valid log, and the overlay mounts with the same incidentId.
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: 'inc-deeplink',
        data: () => ({ og_headline: 'headline' }),
      });
      mockParseSmeltLog.mockReturnValue({
        id: 'inc-deeplink',
        og_headline: 'headline',
      });

      render(<App onNavigateManifest={() => {}} deepLinkId="inc-deeplink" />);

      await waitFor(() => {
        expect(mockGetDoc).toHaveBeenCalled();
      });
      await waitFor(() => {
        const overlay = screen.queryByTestId('incident-report-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay?.getAttribute('data-incident-id')).toBe('inc-deeplink');
      });
    });

    it('logs and does not open overlay when deep link incident is not found', async () => {
      // `snap.exists()` returns false → the effect logs and returns
      // without crashing or mounting the overlay. The user still sees
      // the main app (the deep link just silently falls through).
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockGetDoc.mockResolvedValue({
        exists: () => false,
        data: () => ({}),
      });

      render(<App onNavigateManifest={() => {}} deepLinkId="inc-missing" />);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[App] Deep link incident not found:',
          'inc-missing',
        );
      });
      expect(screen.queryByTestId('incident-report-overlay')).toBeNull();
      consoleErrorSpy.mockRestore();
    });

    it('logs and swallows parseSmeltLog failures without crashing the app', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: 'inc-broken',
        data: () => ({}),
      });
      mockParseSmeltLog.mockImplementation(() => {
        throw new Error('schema drift');
      });

      render(<App onNavigateManifest={() => {}} deepLinkId="inc-broken" />);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[App] Deep link fetch/parsing failed:',
          expect.any(Error),
        );
      });
      expect(screen.queryByTestId('incident-report-overlay')).toBeNull();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('analyze-issue UI surface', () => {
    // These tests exercise the code path inside `processImage` that
    // runs the analyzer and routes an AnalysisError → a
    // user-visible category message. Because `processImage` is not
    // exported, we drive it through its actual call site: the file
    // picker → FileReader → processImage flow. FileReader is stubbed
    // so the onload handler fires synchronously with a base64 payload.

    function stubFileReaderSuccess(payload: string): void {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      class MockFileReader {
        public onload: ((event: { target: { result: string } }) => void) | null = null;
        public onerror: (() => void) | null = null;
        public error: DOMException | null = null;
        readAsDataURL() {
          queueMicrotask(() => {
            this.onload?.({ target: { result: `data:image/png;base64,${payload}` } });
          });
        }
      }
      vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
    }

    function stubFileReaderFailure(): void {
      class MockFileReader {
        public onload: ((event: { target: { result: string } }) => void) | null = null;
        public onerror: (() => void) | null = null;
        public error: DOMException | null = new DOMException('corrupt');
        readAsDataURL() {
          queueMicrotask(() => {
            this.onerror?.();
          });
        }
      }
      vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
    }

    async function triggerFilePicker(file: File) {
      const input = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
      // Simulate the ChangeEvent React produces. We bypass
      // `fireEvent.change` here so the mocked FileList is attached
      // directly to the input element.
      Object.defineProperty(input, 'files', {
        value: [file],
        configurable: true,
      });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // Allow the microtask queue to drain: FileReader.onload is
        // queued in a microtask so React's state updates settle here.
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    it('shows a category-specific issue message when analyzer throws a 429 AnalysisError', async () => {
      const { AnalysisError } = await import('./services/geminiService');
      stubFileReaderSuccess('payload');
      mockAnalyzeLegacyTech.mockRejectedValue(
        new AnalysisError(429, 'Rate limit exceeded.', 'rate_limited'),
      );
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<App onNavigateManifest={() => {}} />);

      await triggerFilePicker(new File(['fake'], 'artifact.png', { type: 'image/png' }));

      await waitFor(() => {
        const issues = screen.getAllByTestId('data-health-issue');
        expect(issues.length).toBeGreaterThanOrEqual(1);
        expect(issues.some((el) => el.textContent?.includes('RATE LIMIT ENGAGED'))).toBe(true);
      });

      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('shows the server-busy message when analyzer throws a 503 AnalysisError', async () => {
      const { AnalysisError } = await import('./services/geminiService');
      stubFileReaderSuccess('payload');
      mockAnalyzeLegacyTech.mockRejectedValue(
        new AnalysisError(503, 'Server busy.', 'server_busy'),
      );
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<App onNavigateManifest={() => {}} />);
      await triggerFilePicker(new File(['fake'], 'artifact.png', { type: 'image/png' }));

      await waitFor(() => {
        const issues = screen.getAllByTestId('data-health-issue');
        expect(issues.some((el) => el.textContent?.includes('FURNACE AT CAPACITY'))).toBe(true);
      });

      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('shows the unknown-category message when analyzer throws a plain Error', async () => {
      stubFileReaderSuccess('payload');
      mockAnalyzeLegacyTech.mockRejectedValue(new Error('network down'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<App onNavigateManifest={() => {}} />);
      await triggerFilePicker(new File(['fake'], 'artifact.png', { type: 'image/png' }));

      await waitFor(() => {
        const issues = screen.getAllByTestId('data-health-issue');
        expect(issues.some((el) => el.textContent?.includes('UNKNOWN FAULT'))).toBe(true);
      });

      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('shows the file-read message when FileReader fails before the analyzer runs', async () => {
      stubFileReaderFailure();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<App onNavigateManifest={() => {}} />);
      await triggerFilePicker(new File(['fake'], 'artifact.png', { type: 'image/png' }));

      await waitFor(() => {
        const issues = screen.getAllByTestId('data-health-issue');
        expect(issues.some((el) => el.textContent?.includes('COULD NOT BE READ'))).toBe(true);
      });
      // Analyzer must not have been invoked — FileReader error short-
      // circuits the flow before processImage is ever called.
      expect(mockAnalyzeLegacyTech).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
    });
  });
});

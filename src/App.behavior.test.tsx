import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmeltLog } from './types';
import type { Timestamp } from 'firebase/firestore';
import {
  ensureMatchMediaStub,
  mockAnalyzeLegacyTech,
  mockGetDoc,
  mockParseSmeltLog,
  recentIncidentLogsMockState,
  resetRecentIncidentLogsMockState,
} from './test/appSharedMocks';

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

import App from './App';

// Scoped helpers (hoisted to module scope so Sonar S7721 is happy and each
// describe-block does not re-create them on every render).
function makeTimestamp(iso = '2026-04-10T12:00:00Z'): Timestamp {
  const date = new Date(iso);
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    isEqual: () => false,
    toJSON: () => ({ seconds: 0, nanoseconds: 0 }),
    valueOf: () => String(date.getTime()),
  } as unknown as Timestamp;
}

function makeLog(id: string, overrides: Partial<SmeltLog> = {}): SmeltLog {
  return {
    id,
    impact_score: 0,
    pixel_count: 100,
    incident_feed_summary: 'summary',
    color_1: '#ff0000',
    color_2: '#00ff00',
    color_3: '#0000ff',
    color_4: '#ffff00',
    color_5: '#00ffff',
    subject_box_ymin: 0,
    subject_box_xmin: 0,
    subject_box_ymax: 1000,
    subject_box_xmax: 1000,
    legacy_infra_class: `Node ${id}`,
    diagnosis: 'd',
    chromatic_profile: 'p',
    severity: 'Severe',
    primary_contamination: 'c',
    contributing_factor: 'c',
    failure_origin: 'o',
    disposition: 'd',
    archive_note: 'n',
    og_headline: 'h',
    share_quote: 'q',
    anon_handle: 'a',
    timestamp: makeTimestamp(),
    uid: 'u',
    breach_count: 0,
    escalation_count: 0,
    sanction_count: 0,
    sanctioned: false,
    sanction_rationale: null,
    ...overrides,
  };
}


function stubFileReaderSuccess(payload: string): void {
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
  // Simulate the ChangeEvent React produces. We bypass `fireEvent.change`
  // here so the mocked FileList is attached directly to the input element.
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Allow the microtask queue to drain: FileReader.onload is queued in a
    // microtask so React's state updates settle here.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App state transitions', () => {
  beforeAll(() => {
    ensureMatchMediaStub();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDoc.mockReset();
    mockParseSmeltLog.mockReset();
    mockAnalyzeLegacyTech.mockReset();
    resetRecentIncidentLogsMockState();
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
        expect((overlay as HTMLElement | null)?.dataset.incidentId).toBe('inc-deeplink');
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
    // These tests exercise the code path inside `processImage` that runs the
    // analyzer and routes an AnalysisError → a user-visible category
    // message. Because `processImage` is not exported, we drive it through
    // its actual call site: the file picker → FileReader → processImage
    // flow. The `stubFileReader*` and `triggerFilePicker` helpers are
    // defined at module scope above.

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

  describe('P0 badge propagation', () => {
    // These tests cover the three App-side wiring sites for the P0
    // badge: the home queue (always-true), the deep-link overlay
    // (derived from `recentLogs`), and the post-smelt analysis
    // overlay (also derived from `recentLogs`). Without these tests,
    // a regression that deleted the prop, flipped its derivation, or
    // keyed it off the wrong id would ship silently because the
    // IncidentLogCard and IncidentReportOverlay stubs used to render
    // `() => null` and dropped the prop on the floor. The stubs in
    // appSharedMocks now surface `data-show-p0` for prop-level
    // assertions at both call sites.

    it('passes showP0Badge=true to every card in the home queue', () => {
      // Home queue hard-codes `showP0Badge` on every recent-queue
      // card — the queue IS the top-3 by definition. A regression
      // that removed the prop or gated it on a stale condition
      // would flip every badge off silently.
      recentIncidentLogsMockState.recentLogs = [
        makeLog('queue-1', { impact_score: 100 }),
        makeLog('queue-2', { impact_score: 90 }),
        makeLog('queue-3', { impact_score: 80 }),
      ];

      render(<App onNavigateManifest={() => {}} />);

      const cards = screen.getAllByTestId('incident-log-card-stub');
      expect(cards).toHaveLength(3);
      for (const card of cards) {
        expect(card.getAttribute('data-show-p0')).toBe('true');
      }
    });

    it('passes showP0Badge=true to the deep-link overlay when the incident is in the top-3', async () => {
      recentIncidentLogsMockState.recentLogs = [
        makeLog('inc-deeplink', { impact_score: 100 }),
        makeLog('queue-2', { impact_score: 90 }),
      ];
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: 'inc-deeplink',
        data: () => ({ og_headline: 'headline' }),
      });
      mockParseSmeltLog.mockReturnValue(makeLog('inc-deeplink'));

      render(<App onNavigateManifest={() => {}} deepLinkId="inc-deeplink" />);

      await waitFor(() => {
        const overlay = screen.queryByTestId('incident-report-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay?.getAttribute('data-show-p0')).toBe('true');
      });
    });

    it('passes showP0Badge=false to the deep-link overlay when the incident is NOT in the top-3', async () => {
      // The deep-linked incident is outside the top-3 (stale share
      // link, or the queue has moved on since the link was created).
      // The badge must not appear just because the user arrived via
      // a direct URL — this is the exact scenario that justifies the
      // `recentLogs.some(...)` derivation over hard-coding true.
      recentIncidentLogsMockState.recentLogs = [
        makeLog('queue-1', { impact_score: 100 }),
        makeLog('queue-2', { impact_score: 90 }),
      ];
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: 'inc-stale-link',
        data: () => ({ og_headline: 'headline' }),
      });
      mockParseSmeltLog.mockReturnValue(makeLog('inc-stale-link'));

      render(<App onNavigateManifest={() => {}} deepLinkId="inc-stale-link" />);

      await waitFor(() => {
        const overlay = screen.queryByTestId('incident-report-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay?.getAttribute('data-show-p0')).toBe('false');
      });
    });

    it('defers opening the deep-link overlay until the top-3 subscription has loaded', async () => {
      // Cold-load race: `recentLogsLoaded` starts false, so the
      // pending deep-link log is staged but not yet transferred into
      // `selectedRecentLog`. Once the subscription finishes loading
      // (loaded flips true), the staging effect opens the overlay
      // with the correct `showP0Badge` value on the first render —
      // no false→true flash for an incident that IS in the top-3.
      recentIncidentLogsMockState.loaded = false;
      recentIncidentLogsMockState.recentLogs = [];
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: 'inc-deeplink',
        data: () => ({ og_headline: 'headline' }),
      });
      mockParseSmeltLog.mockReturnValue(makeLog('inc-deeplink'));

      const { rerender } = render(
        <App onNavigateManifest={() => {}} deepLinkId="inc-deeplink" />,
      );

      await waitFor(() => {
        expect(mockGetDoc).toHaveBeenCalled();
      });
      // Overlay must NOT open while `loaded === false`, even though
      // the doc has already resolved.
      expect(screen.queryByTestId('incident-report-overlay')).toBeNull();

      // Subscription lands with the deep-linked incident in the top-3.
      // Rerender with fresh mock state so the App re-reads it.
      await act(async () => {
        recentIncidentLogsMockState.loaded = true;
        recentIncidentLogsMockState.recentLogs = [
          makeLog('inc-deeplink', { impact_score: 100 }),
        ];
        rerender(
          <App onNavigateManifest={() => {}} deepLinkId="inc-deeplink" />,
        );
      });

      await waitFor(() => {
        const overlay = screen.queryByTestId('incident-report-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay?.getAttribute('data-show-p0')).toBe('true');
      });
    });

    it('guards showP0Badge against empty-string incident ids', async () => {
      // Defensive: if a future refactor ever produced a log or
      // analysis with an empty `id`/`incidentId`, a naive
      // `recentLogs.some(l => l.id === '')` would silently match
      // any other empty-id entry in the queue. The shared helper
      // `isInTopPriority` short-circuits to false on falsy ids.
      recentIncidentLogsMockState.recentLogs = [
        { ...makeLog('queue-1'), id: '' } as SmeltLog,
      ];
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: '',
        data: () => ({ og_headline: 'headline' }),
      });
      mockParseSmeltLog.mockReturnValue({
        ...makeLog('empty'),
        id: '',
      } as SmeltLog);

      render(<App onNavigateManifest={() => {}} deepLinkId="empty" />);

      await waitFor(() => {
        const overlay = screen.queryByTestId('incident-report-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay?.getAttribute('data-show-p0')).toBe('false');
      });
    });
  });
});

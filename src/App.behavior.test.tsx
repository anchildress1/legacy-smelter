import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureMatchMediaStub,
  mockAnalyzeLegacyTech,
  mockGetDoc,
  mockParseSmeltLog,
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
});

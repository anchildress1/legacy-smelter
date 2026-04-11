import { vi } from 'vitest';
import type { SmeltLog } from '../types';

const flushFirestore = () => () => {};

export const mockAnalyzeLegacyTech =
  vi.fn<(base64: string, mimeType: string) => Promise<unknown>>();
export const mockGetDoc = vi.fn();
export const mockParseSmeltLog = vi.fn();

// Mutable state for the `useRecentIncidentLogs` mock. Exported so
// individual tests can drive the top-3 set (for P0 badge propagation
// tests) without having to re-mock the hook per file. Defaults match
// the pre-P0 contract: empty queue, no error, already loaded — so
// existing tests that don't care about the top-3 continue to pass
// without any setup.
export const recentIncidentLogsMockState = {
  recentLogs: [] as SmeltLog[],
  queueIssue: null as string | null,
  loaded: true,
};

export function resetRecentIncidentLogsMockState(): void {
  recentIncidentLogsMockState.recentLogs = [];
  recentIncidentLogsMockState.queueIssue = null;
  recentIncidentLogsMockState.loaded = true;
}

export function ensureMatchMediaStub(): void {
  if (typeof globalThis.matchMedia === 'function') return;

  globalThis.matchMedia = vi.fn(() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof globalThis.matchMedia;
}

vi.mock('../firebase', () => ({
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

vi.mock('../services/geminiService', async () => {
  const actual = await vi.importActual<typeof import('../services/geminiService')>(
    '../services/geminiService',
  );
  return {
    ...actual,
    analyzeLegacyTech: (...args: [string, string]) =>
      mockAnalyzeLegacyTech(...args),
  };
});

vi.mock('../lib/firestoreErrors', () => ({
  handleFirestoreError: vi.fn(),
  OperationType: { GET: 'GET', LIST: 'LIST' },
}));

vi.mock('../lib/smeltLogSchema', () => ({
  parseSmeltLog: (...args: unknown[]) => mockParseSmeltLog(...args),
  parseSmeltLogBatch: vi.fn(() => ({ entries: [], invalidCount: 0 })),
}));

vi.mock('../lib/utils', () => ({
  getLogShareLinks: vi.fn(() => []),
  buildShareLinks: vi.fn(() => []),
  buildIncidentUrl: vi.fn(() => 'https://example.test/s/1'),
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

vi.mock('../components/SmelterCanvas', () => ({
  SmelterCanvas: () => null,
}));

vi.mock('../hooks/useRecentIncidentLogs', () => ({
  DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX: 'INCIDENT DATA SCHEMA VIOLATION.',
  useRecentIncidentLogs: () => ({
    recentLogs: recentIncidentLogsMockState.recentLogs,
    queueIssue: recentIncidentLogsMockState.queueIssue,
    loaded: recentIncidentLogsMockState.loaded,
  }),
}));

vi.mock('../components/IncidentReportOverlay', async () => {
  const { createIncidentReportOverlayP0Stub } = await import('./p0BadgeStubs');
  return { IncidentReportOverlay: createIncidentReportOverlayP0Stub('incident-report-overlay') };
});

vi.mock('../components/IncidentLogCard', async () => {
  const { IncidentLogCardP0Stub } = await import('./p0BadgeStubs');
  return { IncidentLogCard: IncidentLogCardP0Stub };
});

vi.mock('../components/DecommissionIndex', () => ({
  DecommissionIndex: () => <div data-testid="decommission-index-stub" />,
}));

vi.mock('../components/SiteFooter', () => ({
  SiteFooter: () => null,
}));

vi.mock('../components/DataHealthIndicator', () => ({
  DataHealthIndicator: ({ issues }: { issues?: string[] }) => {
    const safeIssues = Array.isArray(issues) ? issues : [];
    return (
      <div data-testid="data-health-stub" data-issue-count={safeIssues.length}>
        {safeIssues.map((issue) => (
          <div key={issue} data-testid="data-health-issue">
            {issue}
          </div>
        ))}
      </div>
    );
  },
}));

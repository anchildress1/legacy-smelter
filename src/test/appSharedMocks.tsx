import { vi } from 'vitest';

const flushFirestore = () => () => {};

export const mockAnalyzeLegacyTech =
  vi.fn<(base64: string, mimeType: string) => Promise<unknown>>();
export const mockGetDoc = vi.fn();
export const mockParseSmeltLog = vi.fn();

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

vi.mock('../components/IncidentReportOverlay', () => ({
  IncidentReportOverlay: ({ incidentId }: { incidentId: string }) => (
    <div data-testid="incident-report-overlay" data-incident-id={incidentId} />
  ),
}));

vi.mock('../components/IncidentLogCard', () => ({
  IncidentLogCard: () => null,
}));

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

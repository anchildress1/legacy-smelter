import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Regression test for the mobile header layout. The screenshot review
// flagged two issues:
//   1. `hidden sm:flex` on the tagline dropped the product voice from
//      the mobile header entirely.
//   2. `flex flex-col sm:flex-row` on the Process/Deploy controls forced
//      them into a stacked column on mobile, eating vertical space.
//
// This test file exists to pin those two facts at the DOM level. The
// App component pulls in Firebase, Howler, Pixi, Gemini, and a handful
// of feature modules — every one of which is replaced by a minimal mock
// below so the render stays synchronous and hermetic.
//
// jsdom reports a wide viewport (1024×768) by default, so Tailwind's
// `sm:` responsive classes would mask a regression that only breaks on
// mobile. Instead of trying to simulate a small viewport (which Tailwind
// cannot respond to in jsdom because there is no matchMedia resolver
// layer that triggers a class re-evaluation), the assertions inspect
// `classList` directly and verify the mobile-first classes are present
// and the `hidden`/`flex-col` defaults are absent. That is what a
// broken mobile layout would actually look like at the source level.

const flushFirestore = () => () => {};

vi.mock('./firebase', () => ({
  db: { __db: true },
  collection: vi.fn(() => ({ __collection: true })),
  onSnapshot: vi.fn(() => flushFirestore()),
  query: vi.fn(() => ({ __query: true })),
  orderBy: vi.fn(() => ({ __orderBy: true })),
  limit: vi.fn(() => ({ __limit: true })),
  doc: vi.fn(() => ({ __doc: true })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
}));

vi.mock('./services/geminiService', () => ({
  analyzeLegacyTech: vi.fn(),
}));

vi.mock('./lib/firestoreErrors', () => ({
  handleFirestoreError: vi.fn(),
  OperationType: { GET: 'GET', LIST: 'LIST' },
}));

vi.mock('./lib/smeltLogSchema', () => ({
  parseSmeltLog: vi.fn(() => null),
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

// Howler constructs an AudioContext at module scope when `new Howl(...)`
// runs in App.tsx — jsdom has no AudioContext, so the constructor is
// neutered here. Returning a lightweight shape keeps the module-level
// variable references valid without touching audio subsystems.
vi.mock('howler', () => ({
  Howl: vi.fn(function HowlMock(this: unknown) {
    return {
      play: vi.fn(),
      stop: vi.fn(),
      volume: vi.fn(),
    };
  }),
}));

// SmelterCanvas is lazy-imported; the lazy resolution never runs in
// this test because we never start a smelt flow. Still mock the module
// so the lazy import does not pull Pixi.
vi.mock('./components/SmelterCanvas', () => ({
  SmelterCanvas: () => null,
}));

vi.mock('./components/IncidentReportOverlay', () => ({
  IncidentReportOverlay: () => null,
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
  DataHealthIndicator: () => <div data-testid="data-health-stub" />,
}));

import App from './App';

describe('App mobile header layout', () => {
  beforeAll(() => {
    // A handful of the lower-level components reach for `matchMedia`
    // during their own mount effects even though we've stubbed them.
    // Provide a minimal shim so the render never reaches an undefined
    // property access.
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

  it('renders the tagline without a `hidden` class so mobile users see it', () => {
    render(<App onNavigateManifest={() => {}} />);

    const tagline = screen.getByTestId('site-tagline');
    // The bug was `hidden sm:flex`: Tailwind's `hidden` sets
    // `display: none`, so the tagline vanished on every breakpoint below
    // `sm` (640px). Guard against it returning.
    expect(tagline.classList.contains('hidden')).toBe(false);
    expect(tagline.classList.contains('flex')).toBe(true);

    // The actual tagline copy must be reachable through the rendered tree.
    expect(within(tagline).getByText(/if a bug exists, apply hotfix\./i)).toBeInTheDocument();
  });

  it('lays out the Process/Deploy buttons in a row on mobile, not stacked in a column', () => {
    render(<App onNavigateManifest={() => {}} />);

    const controls = screen.getByTestId('smelter-controls');
    // Mobile-first layout: `flex flex-row` at every breakpoint. A
    // regression that reintroduces `flex-col` would fail here without
    // needing a small-viewport harness.
    expect(controls.classList.contains('flex-row')).toBe(true);
    expect(controls.classList.contains('flex-col')).toBe(false);
    expect(controls.classList.contains('flex')).toBe(true);

    // Both buttons must be accessible and live in the controls container
    // (not rendered elsewhere and referenced by id).
    const processButton = within(controls).getByRole('button', { name: /process artifact/i });
    const deployButton = within(controls).getByRole('button', { name: /deploy scanner/i });
    expect(processButton).toBeInTheDocument();
    expect(deployButton).toBeInTheDocument();
  });

  it('collapses the "ALL INCIDENTS" nav label to "ALL" on mobile while preserving the accessible name', () => {
    render(<App onNavigateManifest={() => {}} />);

    // The accessible name is pinned via aria-label so screen readers
    // always hear "All incidents" regardless of which visual label is
    // rendered at the current breakpoint.
    const navButton = screen.getByRole('button', { name: /^all incidents$/i });
    expect(navButton).toBeInTheDocument();

    // Both the short and long visual labels are present in the DOM —
    // Tailwind toggles their visibility via `sm:hidden`/`hidden sm:inline`.
    // Asserting both exist guarantees neither label was deleted.
    expect(within(navButton).getByText(/^ALL$/)).toBeInTheDocument();
    expect(within(navButton).getByText(/^ALL INCIDENTS$/)).toBeInTheDocument();
  });
});

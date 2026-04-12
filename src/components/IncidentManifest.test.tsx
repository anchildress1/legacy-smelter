import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmeltLog } from '../types';
import {
  makeFixtureLog as makeLog,
  makeFixtureTimestamp as makeTimestamp,
} from '../test/smeltLogFixtures';

// This suite pins the P0 badge propagation on the manifest side.
// The manifest uses `useRecentIncidentLogs` (the exact same hook the
// home queue uses, limited to 3 docs, sorted impact desc then
// timestamp desc) to derive the authoritative top-3 ids. A matching
// card anywhere on the manifest — regardless of current filter or
// sort — must carry the `showP0Badge` prop. Home-page and deep-link
// overlay propagation is covered in `App.behavior.test.tsx`; this
// file focuses on the manifest's derivation.
//
// `IncidentLogCard` is stubbed to a transparent wrapper that
// surfaces the `showP0Badge` prop as a data attribute, so the
// assertions can check the PROP VALUE — not the rendered DOM of
// the real card (whose output is covered in IncidentLogCard.test).

// Controllable mock state for the three hooks the manifest pulls
// from. `beforeEach` reseeds everything back to defaults so test
// order can't leak state.
interface HookState {
  readonly allLogs: SmeltLog[];
  readonly isLoading: boolean;
  readonly manifestIssue: string | null;
  readonly recentLogs: SmeltLog[];
  readonly recentIssue: string | null;
}
const hookState: HookState & {
  allLogs: SmeltLog[];
  isLoading: boolean;
  manifestIssue: string | null;
  recentLogs: SmeltLog[];
  recentIssue: string | null;
} = {
  allLogs: [],
  isLoading: false,
  manifestIssue: null,
  recentLogs: [],
  recentIssue: null,
};

vi.mock('../hooks/useManifestLogs', () => ({
  MANIFEST_FETCH_LIMIT: 500,
  useManifestLogs: () => ({
    allLogs: hookState.allLogs,
    isLoading: hookState.isLoading,
    manifestIssue: hookState.manifestIssue,
  }),
}));

vi.mock('../hooks/useRecentIncidentLogs', () => ({
  useRecentIncidentLogs: () => ({
    recentLogs: hookState.recentLogs,
    queueIssue: hookState.recentIssue,
  }),
}));

vi.mock('../hooks/useGlobalStats', () => ({
  useGlobalStats: () => ({
    globalStats: { totalIncidents: 0, totalBreaches: 0, totalEscalations: 0 },
    statsIssue: null,
  }),
}));

// Stub the card so assertions can check the `showP0Badge` prop
// directly via a data attribute. The real card's rendering is
// covered in IncidentLogCard.test.tsx — this suite only cares
// about what the MANIFEST decides to pass in.
vi.mock('./ManifestIncidentCard', async () => {
  const { IncidentLogCardP0Stub } = await import('../test/p0BadgeStubs');
  return { ManifestIncidentCard: IncidentLogCardP0Stub };
});

// The manifest also pulls in the detail overlay, footer,
// decommission index, and data health indicator. Of these, the
// overlay is relevant to the P0 wiring — the back card must mirror
// the front card's badge treatment. Stub it to surface `showP0Badge`
// and `incidentId` as data attributes so overlay propagation can be
// asserted at the prop level without rendering the real report body.
vi.mock('./IncidentReportOverlay', async () => {
  const { IncidentReportOverlayP0Stub } = await import('../test/p0BadgeStubs');
  return { IncidentReportOverlay: IncidentReportOverlayP0Stub };
});
vi.mock('./DecommissionIndex', () => ({
  DecommissionIndex: () => null,
}));
vi.mock('./SiteFooter', () => ({
  SiteFooter: () => null,
}));
vi.mock('./DataHealthIndicator', () => ({
  DataHealthIndicator: () => null,
}));

vi.mock('../lib/utils', () => ({
  getLogShareLinks: vi.fn(() => []),
  formatTimestamp: vi.fn(() => '2026-04-11'),
  getFiveDistinctColors: vi.fn(() => ['#000', '#111', '#222', '#333', '#444']),
  buildIncidentUrl: vi.fn(() => 'https://example.test/s/1'),
  formatPixels: vi.fn(() => ({ value: '0', unit: 'MEGAPIXELS' })),
}));

import { IncidentManifest } from './IncidentManifest';

function cardsById(): Map<string, HTMLElement> {
  const cards = screen.getAllByTestId('incident-log-card-stub');
  return new Map(
    cards.map((el) => [el.dataset.logId ?? '', el]),
  );
}

function clickCardAndExpectOverlayBadge(
  cardId: string,
  expectedBadge: 'true' | 'false',
): void {
  const card = cardsById().get(cardId);
  expect(card).toBeDefined();
  if (!card) throw new Error(`${cardId} card should be rendered`);
  fireEvent.click(card);

  const overlay = screen.getByTestId('incident-report-overlay-stub');
  expect(overlay.dataset.incidentId).toBe(cardId);
  expect(overlay.dataset.showP0).toBe(expectedBadge);
}

beforeEach(() => {
  hookState.allLogs = [];
  hookState.isLoading = false;
  hookState.manifestIssue = null;
  hookState.recentLogs = [];
  hookState.recentIssue = null;
});

describe('IncidentManifest — P0 badge propagation', () => {
  // POSITIVE: the manifest flags every card whose id appears in the
  // `useRecentIncidentLogs` result with `showP0Badge`. No more, no
  // fewer — a regression that inverted the Set lookup would fail
  // both this test and the negative-case partner below.

  it('flags cards whose id is in the top-3 recent-logs set', () => {
    hookState.allLogs = [
      makeLog('top-a', { impact_score: 100 }),
      makeLog('top-b', { impact_score: 90 }),
      makeLog('top-c', { impact_score: 80 }),
      makeLog('other-1', { impact_score: 10 }),
      makeLog('other-2', { impact_score: 5 }),
    ];
    hookState.recentLogs = [
      makeLog('top-a'),
      makeLog('top-b'),
      makeLog('top-c'),
    ];

    render(<IncidentManifest onNavigateHome={() => {}} />);

    const byId = cardsById();
    expect(byId.get('top-a')?.dataset.showP0).toBe('true');
    expect(byId.get('top-b')?.dataset.showP0).toBe('true');
    expect(byId.get('top-c')?.dataset.showP0).toBe('true');
  });

  // NEGATIVE: every card whose id is NOT in the top-3 set must pass
  // `showP0Badge={false}`. A blanket-true regression (e.g. always
  // passing the prop) would silently mark every incident as P0.

  it('does not flag cards whose id is not in the top-3 recent-logs set', () => {
    hookState.allLogs = [
      makeLog('top-a', { impact_score: 100 }),
      makeLog('other-1', { impact_score: 10 }),
      makeLog('other-2', { impact_score: 5 }),
    ];
    hookState.recentLogs = [makeLog('top-a')];

    render(<IncidentManifest onNavigateHome={() => {}} />);

    const byId = cardsById();
    expect(byId.get('top-a')?.dataset.showP0).toBe('true');
    expect(byId.get('other-1')?.dataset.showP0).toBe('false');
    expect(byId.get('other-2')?.dataset.showP0).toBe('false');
  });

  // EDGE: empty top-3 list. During initial load or if Firestore
  // returns zero docs for the top query, `topPriorityIds` is an
  // empty Set. NO card should be marked P0 in that state.

  it('marks no cards as P0 when the top-3 list is empty', () => {
    hookState.allLogs = [
      makeLog('a', { impact_score: 100 }),
      makeLog('b', { impact_score: 50 }),
    ];
    hookState.recentLogs = [];

    render(<IncidentManifest onNavigateHome={() => {}} />);

    const cards = screen.getAllByTestId('incident-log-card-stub');
    for (const card of cards) {
      expect(card.dataset.showP0).toBe('false');
    }
  });

  // EDGE: filter swap does not wipe the P0 badge on the cards that
  // remain visible. This is the original bug the user reported —
  // the old `priorityTier` numbering disappeared when filters
  // changed. We swap filters via the filter buttons and check that
  // the top-3 cards that survive the filter still carry the badge.

  it('keeps the P0 badge on top-3 cards after toggling to the Escalated filter', () => {
    hookState.allLogs = [
      makeLog('top-a', { impact_score: 100, escalation_count: 2 }),
      makeLog('top-b', { impact_score: 90 }), // not escalated → will be filtered out
      makeLog('top-c', { impact_score: 80, escalation_count: 1 }),
      makeLog('other-1', { impact_score: 10, escalation_count: 5 }),
    ];
    hookState.recentLogs = [
      makeLog('top-a'),
      makeLog('top-b'),
      makeLog('top-c'),
    ];

    render(<IncidentManifest onNavigateHome={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Escalated/i }));

    const byId = cardsById();
    // top-b was filtered out; the two top-3 cards that remain must
    // still carry the badge.
    expect(byId.has('top-b')).toBe(false);
    expect(byId.get('top-a')?.dataset.showP0).toBe('true');
    expect(byId.get('top-c')?.dataset.showP0).toBe('true');
    // And the non-top-3 escalated card must not pick up the badge
    // just because it happened to survive the filter.
    expect(byId.get('other-1')?.dataset.showP0).toBe('false');
  });

  // EDGE: sort swap does not wipe the P0 badge. Switching to
  // "Newest First" reorders the cards but does not change which ids
  // are in the top-3 query result (that subscription is independent
  // of `sortMode`). All top-3 cards must still carry the badge.

  it('keeps the P0 badge on top-3 cards after switching sort to Newest First', () => {
    hookState.allLogs = [
      makeLog('top-a', {
        impact_score: 100,
        timestamp: makeTimestamp('2026-04-01T00:00:00Z'),
      }),
      makeLog('top-b', {
        impact_score: 90,
        timestamp: makeTimestamp('2026-04-05T00:00:00Z'),
      }),
      makeLog('new-1', {
        impact_score: 10,
        timestamp: makeTimestamp('2026-04-11T00:00:00Z'),
      }),
    ];
    hookState.recentLogs = [makeLog('top-a'), makeLog('top-b')];

    render(<IncidentManifest onNavigateHome={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Sort incidents/i), {
      target: { value: 'newest' },
    });

    const byId = cardsById();
    expect(byId.get('top-a')?.dataset.showP0).toBe('true');
    expect(byId.get('top-b')?.dataset.showP0).toBe('true');
    expect(byId.get('new-1')?.dataset.showP0).toBe('false');
  });

  // EDGE: the badge follows the incident, not the Set identity. A
  // regression that compared Set object references (instead of id
  // membership) would silently drop the badge on every rerender,
  // because the hook memoization returns a fresh Set each time.
  // Rerender with no state change and verify the badges persist.

  it('keeps the P0 badge stable across rerenders when state does not change', () => {
    hookState.allLogs = [
      makeLog('top-a', { impact_score: 100 }),
      makeLog('other-1'),
    ];
    hookState.recentLogs = [makeLog('top-a')];

    const { rerender } = render(<IncidentManifest onNavigateHome={() => {}} />);
    expect(cardsById().get('top-a')?.dataset.showP0).toBe('true');

    rerender(<IncidentManifest onNavigateHome={() => {}} />);
    expect(cardsById().get('top-a')?.dataset.showP0).toBe('true');
  });

  // ERROR / DEFENSIVE: a top-3 id that is NOT present in the
  // manifest's current `allLogs` (e.g. because the manifest window
  // is truncated or a pending write hasn't landed yet) must not
  // throw and must not accidentally mark any unrelated card. We
  // assert that zero cards are flagged when the top-3 ids do not
  // intersect `allLogs`.

  it('does not throw or mislabel when no top-3 id appears in allLogs', () => {
    hookState.allLogs = [makeLog('a'), makeLog('b'), makeLog('c')];
    hookState.recentLogs = [
      makeLog('ghost-1'),
      makeLog('ghost-2'),
      makeLog('ghost-3'),
    ];

    expect(() =>
      render(<IncidentManifest onNavigateHome={() => {}} />),
    ).not.toThrow();

    const cards = screen.getAllByTestId('incident-log-card-stub');
    for (const card of cards) {
      expect(card.dataset.showP0).toBe('false');
    }
  });

  // OVERLAY PROPAGATION: the back-card (detail overlay) must mirror
  // the front-card's P0 treatment. These tests click a stubbed card
  // to open the overlay, then assert that the overlay stub received
  // the same `showP0Badge` value the card had. The overlay itself is
  // stubbed so we only check the prop wiring — the render contract
  // is covered in IncidentReportOverlay.test.tsx.

  it('passes showP0Badge=true to the overlay when a top-3 card is clicked', () => {
    hookState.allLogs = [
      makeLog('top-a', { impact_score: 100 }),
      makeLog('other-1', { impact_score: 5 }),
    ];
    hookState.recentLogs = [makeLog('top-a')];

    render(<IncidentManifest onNavigateHome={() => {}} />);
    clickCardAndExpectOverlayBadge('top-a', 'true');
  });

  it('passes showP0Badge=false to the overlay when a non-top-3 card is clicked', () => {
    hookState.allLogs = [
      makeLog('top-a', { impact_score: 100 }),
      makeLog('other-1', { impact_score: 5 }),
    ];
    hookState.recentLogs = [makeLog('top-a')];

    render(<IncidentManifest onNavigateHome={() => {}} />);
    clickCardAndExpectOverlayBadge('other-1', 'false');
  });
});

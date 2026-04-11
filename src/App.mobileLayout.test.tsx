import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMatchMediaStub } from './test/appSharedMocks';

// BRITTLE BY DESIGN — pins specific Tailwind class names against a
// screenshot-review regression. See below for the rationale.
//
// Regression test for the mobile header layout. The screenshot review
// flagged two issues:
//   1. `hidden sm:flex` on the tagline dropped the product voice from
//      the mobile header entirely.
//   2. `flex flex-col sm:flex-row` on the Process/Deploy controls forced
//      them into a stacked column on mobile, eating vertical space.
//
// This test file exists to pin those two facts at the DOM level. The
// App component pulls in Firebase, Howler, Pixi, Gemini, and a handful
// of feature modules — the shared app test harness replaces those imports
// with minimal mocks so the render stays synchronous and hermetic.
//
// jsdom reports a wide viewport (1024×768) by default, so Tailwind's
// `sm:` responsive classes would mask a regression that only breaks on
// mobile. Instead of trying to simulate a small viewport (which Tailwind
// cannot respond to in jsdom because there is no matchMedia resolver
// layer that triggers a class re-evaluation), the assertions inspect
// `classList` directly and verify the mobile-first classes are present
// and the `hidden`/`flex-col` defaults are absent. That is what a
// broken mobile layout would actually look like at the source level.
//
// A refactor that migrates off Tailwind (CSS modules, a layout component,
// a different utility framework) WILL break this test — that is the
// intended trade-off. Re-pin against whatever the replacement provides,
// or, if the replacement is visually verified another way (a Storybook
// snapshot, a Playwright viewport test), delete this file. Do not treat
// a failing classname assertion here as a test bug without first
// confirming the mobile header still renders correctly.

import App from './App';

describe('App mobile header layout', () => {
  beforeAll(() => {
    // A handful of the lower-level components reach for `matchMedia`
    // during their own mount effects even though they're stubbed.
    // Provide a minimal shim so the render never reaches an undefined
    // property access.
    ensureMatchMediaStub();
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

  it('drops the visible "ALL INCIDENTS" label on mobile and falls back to the icon + aria-label', () => {
    render(<App onNavigateManifest={() => {}} />);

    // The accessible name is pinned via aria-label so screen readers
    // always hear "All incidents" regardless of whether the visible
    // label is shown. On mobile the entire label is hidden — "ALL"
    // alone reads as nonsense, and the tagline + Decommission Index
    // already eat the available header width, so the arrow icon
    // carries the affordance instead.
    const navButton = screen.getByRole('button', { name: /^all incidents$/i });
    expect(navButton).toBeInTheDocument();

    // The full "ALL INCIDENTS" label still lives in the DOM, but its
    // wrapping span must be `hidden sm:inline` so mobile users see only
    // the icon. Asserting the class pins this contract — a regression
    // that drops the `hidden` would re-introduce the cramped header.
    const label = within(navButton).getByText(/^ALL INCIDENTS$/);
    expect(label).toBeInTheDocument();
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('sm:inline');

    // No standalone "ALL" label — that visual was removed in the
    // mobile redesign. Asserting its absence prevents an accidental
    // re-introduction.
    expect(within(navButton).queryByText(/^ALL$/)).toBeNull();
  });
});

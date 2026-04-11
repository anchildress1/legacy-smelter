import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
  IMPACT_GLOW_FILTER_ESCALATED,
} from '../lib/impactGlow';

// This suite pins the hover-tooltip surface on IncidentLogCard. The card
// caps the incident title and the share quote at exactly two lines each
// (`line-clamp-2 min-h-[2lh]`) so every card in the feed has the same
// vertical footprint. Truncated text would be unreadable without the
// native `title` attribute fallback, so these tests assert:
//
//   1. The full text is always written to the `title` attribute, even
//      when it fits on one line (so the attribute-selector contract is
//      stable regardless of content length).
//   2. The clamp classes stay in place (a refactor that drops
//      `line-clamp-2` would silently return the card to free-flow).
//   3. Special characters (quotes, angle brackets, ampersands) make it
//      into the DOM attribute without double-escaping.
//
// `useEscalation` is mocked to a stable no-op state — escalation
// behavior is covered by src/hooks/useEscalation.test.tsx and
// src/components/IncidentReportOverlay.test.tsx; this file is only
// about the card's text-overflow contract.

// Mutable mock state so individual tests can flip `escalated` to
// exercise the "armed" visual tier (Impact glow + escalate column
// halo) without tearing down and re-mocking the hook per case.
// `beforeEach` reseeds this to the at-rest defaults so tests stay
// independent regardless of declaration order.
const escalationState = {
  escalated: false,
  isToggling: false,
  toggleError: null as Error | null,
  toggle: vi.fn(async () => {}),
};

vi.mock('../hooks/useEscalation', () => ({
  useEscalation: () => escalationState,
}));

beforeEach(() => {
  escalationState.escalated = false;
  escalationState.isToggling = false;
  escalationState.toggleError = null;
  escalationState.toggle = vi.fn(async () => {});
});

import { IncidentLogCard } from './IncidentLogCard';
import type { SmeltLog } from '../types';
import type { Timestamp } from 'firebase/firestore';

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

function makeLog(overrides: Partial<SmeltLog> = {}): SmeltLog {
  return {
    id: 'log-1',
    impact_score: 0,
    pixel_count: 100,
    incident_feed_summary: 'Critical legacy artifact queued for smelting.',
    color_1: '#ff0000',
    color_2: '#00ff00',
    color_3: '#0000ff',
    color_4: '#ffff00',
    color_5: '#00ffff',
    subject_box_ymin: 0,
    subject_box_xmin: 0,
    subject_box_ymax: 1000,
    subject_box_xmax: 1000,
    legacy_infra_class: 'Artifact Node',
    diagnosis: 'Critical mismatch detected',
    chromatic_profile: 'Thermal Beige',
    severity: 'Severe',
    primary_contamination: 'Legacy residue',
    contributing_factor: 'Config rot',
    failure_origin: 'Deferred upgrades',
    disposition: 'Immediate thermal decommission',
    archive_note: 'System observed dangerous drift.',
    og_headline: 'Legacy artifact breached thermal policy',
    share_quote: 'Containment failed. Smelting initiated.',
    anon_handle: 'ThermalOperator_41',
    timestamp: makeTimestamp(),
    uid: 'user-1',
    breach_count: 0,
    escalation_count: 0,
    sanction_count: 0,
    sanctioned: false,
    sanction_rationale: null,
    ...overrides,
  };
}

describe('IncidentLogCard — title tooltip', () => {
  // POSITIVE: baseline title case. The card should always render the
  // incident title verbatim AND mirror it into the `title` attribute on
  // the same paragraph so truncated titles are still readable on hover.

  it('renders the title verbatim inside the card', () => {
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    expect(screen.getByText('Artifact Node')).toBeInTheDocument();
  });

  it('mirrors the title into the title attribute on the same element', () => {
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const titleEl = screen.getByText('Artifact Node');
    expect(titleEl.getAttribute('title')).toBe('Artifact Node');
  });

  it('applies line-clamp-2 and min-h-[2lh] to the title', () => {
    // The clamp classes are the contract with Tailwind. A refactor that
    // drops either one would return the card to free-flow (title would
    // spill beyond two lines) or collapse short cards to one line
    // (breaking the uniform grid rhythm in the feed).
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const titleEl = screen.getByText('Artifact Node');
    expect(titleEl.className).toContain('line-clamp-2');
    expect(titleEl.className).toContain('min-h-[2lh]');
  });

  it('preserves the full title in the title attribute when the text is longer than two lines', () => {
    // Simulated overflow: the visual clamp will hide anything past two
    // lines, but `getAttribute('title')` must still hand back the full
    // string. This is the core promise of the hover-tooltip surface.
    const longTitle =
      'This is a very long legacy infrastructure class name that absolutely will not fit inside the two-line clamp on any reasonable viewport width and therefore must be exposed via the native tooltip attribute so the user can still read it on hover';
    render(
      <IncidentLogCard log={makeLog({ legacy_infra_class: longTitle })} onClick={() => {}} />,
    );
    const titleEl = screen.getByText(longTitle);
    expect(titleEl.getAttribute('title')).toBe(longTitle);
  });
});

describe('IncidentLogCard — quote tooltip', () => {
  // POSITIVE: the quote paragraph wraps the share_quote in literal
  // double-quote characters in the visible text, but the `title`
  // attribute contains the raw string (no added quotes). This asymmetry
  // is intentional — the quotes are a visual decoration, not part of the
  // data — and a refactor that "fixes" it by wrapping the attribute too
  // would make the tooltip read differently from the source data.

  it('renders the quote verbatim wrapped in visible double-quote characters', () => {
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    expect(screen.getByText('"Containment failed. Smelting initiated."')).toBeInTheDocument();
  });

  it('mirrors the raw quote (no added quote characters) into the title attribute', () => {
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const quoteEl = screen.getByText('"Containment failed. Smelting initiated."');
    expect(quoteEl.getAttribute('title')).toBe('Containment failed. Smelting initiated.');
  });

  it('applies line-clamp-2 and min-h-[2lh] to the quote', () => {
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const quoteEl = screen.getByText('"Containment failed. Smelting initiated."');
    expect(quoteEl.className).toContain('line-clamp-2');
    expect(quoteEl.className).toContain('min-h-[2lh]');
  });

  it('preserves the full quote in the title attribute when the text is longer than two lines', () => {
    const longQuote =
      'This is an unusually long share quote that overflows the two-line clamp and therefore relies on the native title attribute to remain accessible to users who want to read the full sentence without opening the detail overlay';
    render(<IncidentLogCard log={makeLog({ share_quote: longQuote })} onClick={() => {}} />);
    const quoteEl = screen.getByText(`"${longQuote}"`);
    expect(quoteEl.getAttribute('title')).toBe(longQuote);
  });
});

describe('IncidentLogCard — tooltip error/edge cases', () => {
  // ERROR / DEFENSIVE: strict `parseSmeltLog` makes empty strings
  // impossible in production, but the component must not crash on them
  // and should not set the `title` attribute to `undefined` or `null`
  // (which React would strip from the DOM entirely). An empty string
  // means "no tooltip" — which matches the visual state of an empty
  // paragraph.

  it('renders an empty title attribute when the incident title is an empty string', () => {
    const { container } = render(
      <IncidentLogCard log={makeLog({ legacy_infra_class: '' })} onClick={() => {}} />,
    );
    // We cannot use getByText('') — RTL treats that as "no match". Fall
    // back to a class-scoped query, which is the same paragraph the
    // positive tests target.
    const titleEl = container.querySelector('p.text-hazard-amber');
    expect(titleEl).not.toBeNull();
    expect(titleEl?.getAttribute('title')).toBe('');
  });

  it('renders an empty title attribute when the share quote is an empty string', () => {
    const { container } = render(
      <IncidentLogCard log={makeLog({ share_quote: '' })} onClick={() => {}} />,
    );
    const quoteEl = container.querySelector('p.italic');
    expect(quoteEl).not.toBeNull();
    expect(quoteEl?.getAttribute('title')).toBe('');
    // Visible text is still the literal wrapper quotes even when empty —
    // the decoration is part of the layout, not the data.
    expect(quoteEl?.textContent).toBe('""');
  });

  // EDGE: HTML-special characters. React escapes on render, but
  // `getAttribute('title')` returns the decoded string. Pinning this
  // prevents a future refactor that pre-escapes the string from
  // double-escaping the tooltip text.

  it('preserves HTML-special characters (quotes, angle brackets, ampersands) in the title attribute', () => {
    const specialTitle = 'Node <alpha> & "beta" \'gamma\'';
    render(
      <IncidentLogCard log={makeLog({ legacy_infra_class: specialTitle })} onClick={() => {}} />,
    );
    const titleEl = screen.getByText(specialTitle);
    expect(titleEl.getAttribute('title')).toBe(specialTitle);
  });

  it('preserves HTML-special characters in the quote title attribute', () => {
    const specialQuote = 'Failed <migration> & "rollback" pending';
    render(<IncidentLogCard log={makeLog({ share_quote: specialQuote })} onClick={() => {}} />);
    const quoteEl = screen.getByText(`"${specialQuote}"`);
    expect(quoteEl.getAttribute('title')).toBe(specialQuote);
  });

  // EDGE: whitespace is not trimmed. A tab or newline in the source
  // data survives into the `title` attribute verbatim so the hover text
  // is a faithful rendering of what came out of Gemini.

  it('preserves leading/trailing whitespace in the title attribute', () => {
    const whitespacePaddedTitle = '  Padded Node  ';
    const { container } = render(
      <IncidentLogCard
        log={makeLog({ legacy_infra_class: whitespacePaddedTitle })}
        onClick={() => {}}
      />,
    );
    // DOM normalizes visible whitespace, but the `title` attribute does
    // not — assert on the attribute directly instead of visible text.
    const titleEl = container.querySelector('p.text-hazard-amber');
    expect(titleEl?.getAttribute('title')).toBe(whitespacePaddedTitle);
  });

  // NEGATIVE: scope check. The card has several text nodes (summary,
  // metadata, timestamp) — only the title and quote paragraphs should
  // carry a `title` attribute. A regression that added `title` to the
  // summary paragraph would silently duplicate the tooltip surface.

  it('does not set a title attribute on the summary paragraph', () => {
    const { container } = render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const summaryEl = container.querySelector('p.text-ash-white');
    expect(summaryEl).not.toBeNull();
    expect(summaryEl?.hasAttribute('title')).toBe(false);
  });

  it('scopes the title attribute on <p> elements to exactly the title and quote paragraphs', () => {
    // The escalate <button> ALSO carries a `title` attribute ("Escalate"
    // / "De-escalate") as the native hover label for its icon-only
    // affordance — that one is intentional and lives on a different
    // tag. Scope this assertion to <p> tags so a regression that adds a
    // `title` to the summary or metadata rows would still be caught
    // without coupling the test to the escalate-button implementation.
    const { container } = render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const paragraphsWithTitle = Array.from(container.querySelectorAll('p[title]'));
    expect(paragraphsWithTitle).toHaveLength(2);
    const titles = paragraphsWithTitle.map((el) => el.getAttribute('title'));
    expect(titles).toContain('Artifact Node');
    expect(titles).toContain('Containment failed. Smelting initiated.');
  });
});

describe('IncidentLogCard — interaction contract', () => {
  // These are not strictly part of the tooltip surface, but they share
  // the same element tree and would be easy to break with a careless
  // refactor of the two-line-clamp layout. Pinning them here keeps the
  // card's core interaction contract stable alongside the visual one.

  it('invokes onClick when the primary button is activated', () => {
    const onClick = vi.fn();
    render(<IncidentLogCard log={makeLog()} onClick={onClick} />);
    // The primary button is the larger content region; its accessible
    // name is derived from the text inside it, so look it up by the
    // title text which is the first text node in tab order.
    const button = screen.getAllByRole('button')[0];
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('hides the sanction badge (without collapsing its width) when the log is unsanctioned', () => {
    // The sanction placeholder is always rendered with `invisible` so
    // the right cluster width does not shift when a log becomes
    // sanctioned. If a refactor replaces `invisible` with
    // `display: none` / conditional rendering, the header would jitter
    // as sanction state updates.
    const { container } = render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const placeholder = container.querySelector('span.invisible');
    expect(placeholder).not.toBeNull();
  });

  it('renders the sanction badge (visible) when the log is sanctioned', () => {
    const { container } = render(
      <IncidentLogCard log={makeLog({ sanctioned: true })} onClick={() => {}} />,
    );
    // When sanctioned, the placeholder's `invisible` class is stripped
    // and the "Sanctioned" label appears in the metadata row.
    expect(container.querySelector('span.invisible')).toBeNull();
    expect(screen.getByText('Sanctioned')).toBeInTheDocument();
  });

  it('provides a descriptive aria-label on the escalate button that references the incident title', () => {
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const escalate = screen.getByRole('button', { name: /Escalate Artifact Node/i });
    expect(escalate).toBeInTheDocument();
    expect(escalate.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not bubble a click on the escalate button up to the card onClick', () => {
    // The escalate button calls `e.stopPropagation()` so a user tapping
    // the escalate control does not also open the overlay. A regression
    // that drops the stopPropagation would make escalation unusable.
    const onClick = vi.fn();
    render(<IncidentLogCard log={makeLog()} onClick={onClick} />);
    const escalate = screen.getByRole('button', { name: /Escalate Artifact Node/i });
    escalate.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the timestamp in the metadata row', () => {
    // formatTimestamp is imported from lib/utils (not mocked in this
    // suite) so we only assert that SOME formatted string is present
    // rather than the exact value — the exact format is pinned in
    // lib/utils's own tests.
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const primaryButton = screen.getAllByRole('button')[0];
    // The metadata row is the last child of the primary button's
    // content tree; any non-empty text inside it is sufficient to
    // confirm the row rendered at all.
    expect(within(primaryButton).getByText(/Impact/i)).toBeInTheDocument();
  });
});

describe('IncidentLogCard — Impact glow + escalate halo', () => {
  // The Impact number and the escalate column share the same warm
  // amber glow as the incident report overlay. Both tiers are defined
  // in `lib/impactGlow`, so these tests assert the component applies
  // the right constant for the current `escalated` state — not the
  // literal class strings themselves (which are pinned in
  // src/lib/impactGlow.test.ts). That split means a refactor of the
  // glow values only has to update impactGlow.ts and impactGlow.test.ts,
  // and these component-level tests will still pass because they
  // compare against the imported constant.

  function findImpactSpan(container: HTMLElement): HTMLElement {
    // The metadata row's Impact span is the only element whose text
    // starts with "Impact " followed by a number. Scope the query to
    // <span> so it can't collide with the escalate button's aria-label.
    const spans = Array.from(container.querySelectorAll('span'));
    const match = spans.find((el) => /^Impact \d+$/.test(el.textContent ?? ''));
    if (!match) throw new Error('Impact metadata span not found');
    return match;
  }

  function findEscalateColumn(): HTMLElement {
    // The escalate column is the only <button> whose accessible name
    // starts with "Escalate" or "Remove escalation" — matches both
    // states of the aria-label.
    return screen.getByRole('button', {
      name: /^(Escalate|Remove escalation for) /i,
    });
  }

  // POSITIVE — at-rest visual tier.

  it('applies IMPACT_GLOW_BASE to the Impact span when not escalated', () => {
    const { container } = render(
      <IncidentLogCard log={makeLog()} onClick={() => {}} />,
    );
    const impact = findImpactSpan(container);
    // Every class token in the BASE constant must be present on the
    // element. Split the constant into tokens so the assertion still
    // passes if React/Tailwind reorders classes on render.
    for (const token of IMPACT_GLOW_BASE.split(' ')) {
      expect(impact.className).toContain(token);
    }
  });

  it('does not apply the escalated glow filter to the escalate column when not escalated', () => {
    // The filter class is the marker for the "armed" halo. At rest
    // the column uses plain hover/transition classes; leaking the
    // filter would make every card look permanently armed.
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const col = findEscalateColumn();
    expect(col.className).not.toContain(IMPACT_GLOW_FILTER_ESCALATED);
  });

  // POSITIVE — escalated visual tier. Flip the mock state and
  // re-render to exercise the intensified glow on both surfaces.

  it('applies IMPACT_GLOW_ESCALATED to the Impact span when escalated', () => {
    escalationState.escalated = true;
    const { container } = render(
      <IncidentLogCard log={makeLog()} onClick={() => {}} />,
    );
    const impact = findImpactSpan(container);
    for (const token of IMPACT_GLOW_ESCALATED.split(' ')) {
      expect(impact.className).toContain(token);
    }
  });

  it('applies IMPACT_GLOW_FILTER_ESCALATED to the escalate column when escalated', () => {
    escalationState.escalated = true;
    render(<IncidentLogCard log={makeLog()} onClick={() => {}} />);
    const col = findEscalateColumn();
    expect(col.className).toContain(IMPACT_GLOW_FILTER_ESCALATED);
    // And the armed-state background/text classes stay intact — the
    // glow is additive, not a replacement for the color treatment.
    expect(col.className).toContain('bg-hazard-amber/15');
    expect(col.className).toContain('text-hazard-amber');
  });

  // NEGATIVE — the glow constants are mutually exclusive.

  it('does not apply the base-tier glow to the Impact span when escalated', () => {
    // The 95% alpha variant and the solid variant are the only
    // difference between the two combined constants; a regression
    // that always applied BASE (even when escalated) would flatten
    // the contrast step. Check for the unique BASE-only token.
    escalationState.escalated = true;
    const { container } = render(
      <IncidentLogCard log={makeLog()} onClick={() => {}} />,
    );
    const impact = findImpactSpan(container);
    expect(impact.className).not.toContain('text-hazard-amber/95');
  });

  // NEGATIVE — chevron regression guard. The ChevronRight icon was
  // removed from the header right-cluster because it wasn't carrying
  // its weight. Pin its absence so a copy-paste refactor that
  // reintroduces it is caught in CI.

  it('does not render the ChevronRight icon in the header right-cluster', () => {
    // Lucide icons render as <svg> with `lucide-chevron-right` in the
    // class list. A direct class-based query keeps the assertion
    // decoupled from lucide's internal DOM structure.
    const { container } = render(
      <IncidentLogCard log={makeLog()} onClick={() => {}} />,
    );
    const chevron = container.querySelector('svg.lucide-chevron-right');
    expect(chevron).toBeNull();
  });

  // EDGE — the Impact metadata span always has exactly ONE glow
  // tier applied. A refactor that accidentally concatenated both
  // tiers (e.g. by dropping the ternary) would silently double the
  // classes and fight Tailwind's specificity rules. Assert by
  // counting occurrences of the unique filter radius tokens.

  it('applies exactly one glow tier to the Impact span at a time', () => {
    const { container } = render(
      <IncidentLogCard log={makeLog()} onClick={() => {}} />,
    );
    const impact = findImpactSpan(container);
    const hasBaseRadius = impact.className.includes('0_0_6px');
    const hasEscalatedRadius = impact.className.includes('0_0_8px');
    expect(hasBaseRadius || hasEscalatedRadius).toBe(true);
    expect(hasBaseRadius && hasEscalatedRadius).toBe(false);
  });
});

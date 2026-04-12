import { describe, expect, it } from 'vitest';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
  IMPACT_GLOW_FILTER_BASE,
  IMPACT_GLOW_FILTER_ESCALATED,
} from './impactGlow';

// These constants are the single source of truth for the warm amber
// "triggered" glow used on the Impact number (front card + back overlay)
// and the escalate button in both surfaces. Pinning the class strings
// here is load-bearing: the glow has to look identical across every
// surface that consumes it, so drift between any of these values and
// the JSX call sites is a regression. The component tests can only
// check that the classes land on the correct element — this suite
// guards the class definitions themselves.

describe('impactGlow — filter-only constants', () => {
  // POSITIVE: exact class string pins. These are the tuned filter
  // values; a refactor that flattens or amplifies them must be an
  // intentional choice, not silent drift.

  it('IMPACT_GLOW_FILTER_BASE is a 6px drop-shadow at 0.3 opacity', () => {
    expect(IMPACT_GLOW_FILTER_BASE).toBe(
      '[filter:drop-shadow(0_0_6px_rgba(245,200,66,0.3))]',
    );
  });

  it('IMPACT_GLOW_FILTER_ESCALATED is an 8px drop-shadow at 0.55 opacity', () => {
    expect(IMPACT_GLOW_FILTER_ESCALATED).toBe(
      '[filter:drop-shadow(0_0_8px_rgba(245,200,66,0.55))]',
    );
  });

  // NEGATIVE: the filter-only constants MUST NOT include a text
  // color class. They are applied on button elements that already
  // manage their own text color (e.g. `text-hazard-amber` on the
  // triggered pill, `text-stone-gray/60` on the card's escalate
  // column). If a text-color class leaked into the filter-only
  // constants, those buttons would fight the glow's color on
  // hover/focus transitions and produce visible flashes.

  it('IMPACT_GLOW_FILTER_BASE does not include a text-color class', () => {
    expect(IMPACT_GLOW_FILTER_BASE).not.toMatch(/\btext-/);
  });

  it('IMPACT_GLOW_FILTER_ESCALATED does not include a text-color class', () => {
    expect(IMPACT_GLOW_FILTER_ESCALATED).not.toMatch(/\btext-/);
  });

  // NEGATIVE: the two tiers must be distinct. A regression that
  // collapsed them (e.g. by pointing BASE at ESCALATED's filter)
  // would silently remove the visual difference between "at rest"
  // and "triggered" — the whole point of the glow.

  it('base and escalated filter tiers are distinct values', () => {
    expect(IMPACT_GLOW_FILTER_BASE).not.toBe(IMPACT_GLOW_FILTER_ESCALATED);
  });
});

describe('impactGlow — combined text+filter constants', () => {
  // POSITIVE: exact composition. The combined constants are what
  // the overlay and card apply directly to the Impact number, so
  // drift between the filter constant and the combined constant
  // would produce two different glows depending on which surface
  // picked up the change first.

  it('IMPACT_GLOW_BASE composes base filter with hazard-amber/95 text', () => {
    expect(IMPACT_GLOW_BASE).toBe(
      `text-hazard-amber/95 ${IMPACT_GLOW_FILTER_BASE}`,
    );
  });

  it('IMPACT_GLOW_ESCALATED composes escalated filter with solid hazard-amber text', () => {
    expect(IMPACT_GLOW_ESCALATED).toBe(
      `text-hazard-amber ${IMPACT_GLOW_FILTER_ESCALATED}`,
    );
  });

  // POSITIVE: the weaker containment invariant survives a future
  // refactor that appends (say) a transition class to the combined
  // constants without touching the filter values.

  it('IMPACT_GLOW_BASE contains IMPACT_GLOW_FILTER_BASE', () => {
    expect(IMPACT_GLOW_BASE).toContain(IMPACT_GLOW_FILTER_BASE);
  });

  it('IMPACT_GLOW_ESCALATED contains IMPACT_GLOW_FILTER_ESCALATED', () => {
    expect(IMPACT_GLOW_ESCALATED).toContain(IMPACT_GLOW_FILTER_ESCALATED);
  });

  // NEGATIVE: the base combined constant uses the 95% alpha text
  // variant (`text-hazard-amber/95`) and the escalated uses the
  // solid variant (`text-hazard-amber`). Cross-leaking would
  // invert the contrast step that signals "triggered" and flatten the
  // transition into nothing.

  it('IMPACT_GLOW_BASE uses the 95% alpha text-hazard-amber variant', () => {
    expect(IMPACT_GLOW_BASE).toContain('text-hazard-amber/95');
  });

  it('IMPACT_GLOW_ESCALATED uses the solid text-hazard-amber (no alpha)', () => {
    // Match as a whole token to avoid accidentally matching
    // `text-hazard-amber/95` as a prefix.
    expect(IMPACT_GLOW_ESCALATED.split(' ')).toContain('text-hazard-amber');
    expect(IMPACT_GLOW_ESCALATED).not.toContain('text-hazard-amber/95');
  });

  it('base and escalated combined tiers are distinct values', () => {
    expect(IMPACT_GLOW_BASE).not.toBe(IMPACT_GLOW_ESCALATED);
  });
});

describe('impactGlow — monotonicity and empty-string guards', () => {
  // EDGE: numeric monotonicity. The escalated tier must be BIGGER
  // (wider radius, higher alpha) than the base tier — not just
  // different. A swap that inverted them would still pass the
  // distinctness tests above if someone edited both values at
  // once; this numeric comparison catches the inversion.

  const radiusOf = (cls: string): number => {
    const m = /0_0_(\d+)px/.exec(cls);
    if (!m) throw new Error(`no radius parsed from ${cls}`);
    return Number(m[1]);
  };

  const alphaOf = (cls: string): number => {
    const m = /rgba\(245,200,66,([0-9.]+)\)/.exec(cls);
    if (!m) throw new Error(`no alpha parsed from ${cls}`);
    return Number(m[1]);
  };

  it('escalated filter has a wider radius than base', () => {
    expect(radiusOf(IMPACT_GLOW_FILTER_ESCALATED)).toBeGreaterThan(
      radiusOf(IMPACT_GLOW_FILTER_BASE),
    );
  });

  it('escalated filter has a higher alpha than base', () => {
    expect(alphaOf(IMPACT_GLOW_FILTER_ESCALATED)).toBeGreaterThan(
      alphaOf(IMPACT_GLOW_FILTER_BASE),
    );
  });

  // ERROR / DEFENSIVE: none of the exports should ever be empty.
  // An empty string would compile, silently strip the glow from
  // every surface, and never trigger a type error.

  it.each([
    ['IMPACT_GLOW_FILTER_BASE', IMPACT_GLOW_FILTER_BASE],
    ['IMPACT_GLOW_FILTER_ESCALATED', IMPACT_GLOW_FILTER_ESCALATED],
    ['IMPACT_GLOW_BASE', IMPACT_GLOW_BASE],
    ['IMPACT_GLOW_ESCALATED', IMPACT_GLOW_ESCALATED],
  ])('%s is a non-empty string', (_name, value) => {
    expect(typeof value).toBe('string');
    expect(value.length).toBeGreaterThan(0);
  });

  // EDGE: the glow filter uses the hazard-amber RGB triplet that
  // matches the brand palette. A regression that swapped in a
  // different color family (e.g. red) would break the visual
  // cohesion with every other hazard-amber element, and this test
  // catches it without pinning the whole filter string.

  it('both filter tiers use the hazard-amber RGB triplet (245,200,66)', () => {
    expect(IMPACT_GLOW_FILTER_BASE).toContain('rgba(245,200,66,');
    expect(IMPACT_GLOW_FILTER_ESCALATED).toContain('rgba(245,200,66,');
  });
});

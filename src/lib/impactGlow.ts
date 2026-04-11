/**
 * Shared Tailwind classes for the warm amber "armed" glow.
 *
 * The glow treatment is used in two places so the visual language stays
 * in sync across the feed card and the incident report overlay:
 *
 *   1. The Impact number itself — derived score, lead metric — uses the
 *      combined color + filter constants so the amber tint and the
 *      drop-shadow halo move together.
 *   2. The escalate button on both the card and the overlay uses the
 *      filter-only constant when armed, so the button gets the same
 *      warm halo without fighting the button's own text/background
 *      classes.
 *
 * Defining every class string here — rather than inlining them at call
 * sites — keeps the glow from drifting out of sync between surfaces on
 * future refactors.
 */

// Filter-only classes. Apply these anywhere a warm amber halo is
// needed without implying a text-color change (e.g. on buttons that
// already manage their own text color).
export const IMPACT_GLOW_FILTER_BASE =
  '[filter:drop-shadow(0_0_6px_rgba(245,200,66,0.3))]';

export const IMPACT_GLOW_FILTER_ESCALATED =
  '[filter:drop-shadow(0_0_8px_rgba(245,200,66,0.55))]';

// Combined text-color + glow classes for the Impact number itself.
// The base tier is a subtle warm halo behind the lead metric at rest;
// the escalated tier intensifies the radius, opacity, and text color
// so the Impact reads as "armed" — a quiet visual echo of the ARMED
// escalate button.
export const IMPACT_GLOW_BASE = `text-hazard-amber/95 ${IMPACT_GLOW_FILTER_BASE}`;

export const IMPACT_GLOW_ESCALATED = `text-hazard-amber ${IMPACT_GLOW_FILTER_ESCALATED}`;

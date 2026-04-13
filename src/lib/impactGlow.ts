/**
 * Shared Tailwind classes for the warm amber "triggered" glow.
 *
 * The glow treatment is used in two places so the visual language stays
 * in sync across the feed card and the incident report overlay:
 *
 *   1. The Impact number itself — derived score, lead metric — uses the
 *      combined color + filter constants so the amber tint and the
 *      drop-shadow halo move together.
 *   2. The escalate button on both the card and the overlay uses the
 *      button-specific filter constant when triggered — a subtler
 *      glow than the number because the larger surface area of a
 *      button amplifies the drop-shadow disproportionately.
 *
 * Defining every class string here — rather than inlining them at call
 * sites — keeps the glow from drifting out of sync between surfaces on
 * future refactors.
 */

export const IMPACT_GLOW_FILTER_BASE =
  '[filter:drop-shadow(0_0_6px_rgba(245,200,66,0.3))]';

export const IMPACT_GLOW_FILTER_ESCALATED =
  '[filter:drop-shadow(0_0_8px_rgba(245,200,66,0.55))]';

// Subtler variant for button surfaces. The full-intensity escalated
// filter creates an overwhelming amber wash on a 56–64px-wide button
// because drop-shadow scales with the element's painted area. This
// pulls the radius and opacity back so the halo reads as a warm hint,
// not a spotlight.
export const IMPACT_GLOW_FILTER_ESCALATED_BUTTON =
  '[filter:drop-shadow(0_0_5px_rgba(245,200,66,0.25))]';

// Combined text-color + glow classes for the Impact number itself.
// The base tier is a subtle warm halo behind the lead metric at rest;
// the escalated tier intensifies the radius, opacity, and text color
// so the Impact reads as "triggered" — a quiet visual echo of the
// TRIGGERED escalate button.
export const IMPACT_GLOW_BASE = `text-hazard-amber/95 ${IMPACT_GLOW_FILTER_BASE}`;

export const IMPACT_GLOW_ESCALATED = `text-hazard-amber ${IMPACT_GLOW_FILTER_ESCALATED}`;

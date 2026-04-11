/**
 * Shared Tailwind classes for the Impact number's warm drop-shadow glow.
 *
 * Used by the incident report overlay (always visible, two tiers) and
 * the incident feed card (only when the log is escalated) so the visual
 * treatment of the derived Impact score stays consistent across every
 * surface that renders it. Defining the class strings here — rather than
 * inlining them — keeps the hazard-amber glow from drifting out of sync
 * between the card and the overlay on future refactors.
 *
 * The base glow is a subtle warm drop-shadow that sits behind the Impact
 * number at all times in the overlay. The escalated glow intensifies
 * the radius, opacity, and text color so the Impact reads as "armed"
 * — a quiet visual echo of the escalate toggle's ARMED state.
 */
export const IMPACT_GLOW_BASE =
  'text-hazard-amber/95 [filter:drop-shadow(0_0_6px_rgba(245,200,66,0.3))]';

export const IMPACT_GLOW_ESCALATED =
  'text-hazard-amber [filter:drop-shadow(0_0_8px_rgba(245,200,66,0.55))]';

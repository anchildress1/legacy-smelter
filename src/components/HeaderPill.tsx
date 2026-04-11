import React from 'react';

/**
 * Single source of truth for the pill-shaped chips that sit in the incident
 * title clusters (home card header + overlay header): P0 priority, severity,
 * and the escalate toggle. All three must share exactly the same box model —
 * padding, text size, border radius, icon gap — so they line up on a shared
 * baseline. Keeping the base classes in one place is how we prevent visual
 * drift from happening again.
 *
 * Static pills (P0, severity) wrap this component directly. The escalate
 * button is a `<button>` with interactive state (focus ring, hover, escalated
 * glow) that can't be expressed as a pure span, so it imports `HEADER_PILL_BASE`
 * and concatenates its own state classes on top. That is the ONLY sanctioned
 * consumer of the raw constant — new chip-shaped UI should wrap `HeaderPill`.
 */
export const HEADER_PILL_BASE =
  'inline-flex items-center gap-1 rounded border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider';

interface HeaderPillProps {
  readonly children: React.ReactNode;
  readonly icon?: React.ReactNode;
  /** Color/weight classes layered on top of `HEADER_PILL_BASE`. */
  readonly className?: string;
}

export const HeaderPill: React.FC<HeaderPillProps> = ({ children, icon, className = '' }) => (
  <span className={`${HEADER_PILL_BASE} ${className}`}>
    {icon}
    {children}
  </span>
);

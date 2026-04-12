import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface SeverityBadgeProps {
  readonly severity: string;
}

/**
 * Single source of truth for the severity pill rendered next to incident
 * titles. Padding and icon size are tuned to match the box model of the
 * escalate button (`px-2 py-1.5 text-[10px]` + `size={10}` icon) so the
 * two sit at the same height in the overlay header. Every other surface
 * — incident card, post-smelt result strip — pulls the same component so
 * the visual contract cannot drift across views.
 */
export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity }) => {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-hazard-amber/90 bg-hazard-amber/90 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider font-bold text-zinc-950">
      <AlertTriangle size={10} aria-hidden="true" />
      {severity}
    </span>
  );
};

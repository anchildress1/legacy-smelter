import type { FC } from 'react';
import { AlertTriangle } from 'lucide-react';
import { HeaderPill } from './HeaderPill';

interface SeverityBadgeProps {
  readonly severity: string;
}

/**
 * Severity pill rendered next to incident titles. Delegates its box model to
 * `HeaderPill` so it stays pinned to the P0 badge and the overlay escalate
 * button — all three live in the same cluster and must sit at the same
 * height. Every surface (home card, overlay header, post-smelt result strip)
 * pulls this same component so the visual contract cannot drift across views.
 */
export const SeverityBadge: FC<SeverityBadgeProps> = ({ severity }) => (
  <HeaderPill
    icon={<AlertTriangle size={10} aria-hidden="true" />}
    className="border-hazard-amber/90 bg-hazard-amber/90 font-bold text-zinc-950"
  >
    {severity}
  </HeaderPill>
);

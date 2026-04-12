import type { FC } from 'react';
import { ShieldCheck } from 'lucide-react';
import { HeaderPill } from './HeaderPill';

/**
 * Sanction badge rendered in the incident card footer and overlay title area.
 * Delegates box model to `HeaderPill` so it shares the same visual contract
 * as P0 and severity — all three are siblings in the overlay header cluster.
 * Molten-orange (#e8622a) background distinguishes it from the hazard-amber
 * palette used by P0 and severity.
 */
export const SanctionBadge: FC = () => (
  <HeaderPill
    icon={<ShieldCheck size={10} aria-hidden="true" />}
    className="border-molten-orange bg-molten-orange font-bold text-zinc-950"
  >
    Sanctioned
  </HeaderPill>
);

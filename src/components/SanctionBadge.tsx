import type { FC } from 'react';
import { ShieldCheck } from 'lucide-react';
import { HeaderPill } from './HeaderPill';

export const SanctionBadge: FC = () => (
  <HeaderPill
    icon={<ShieldCheck size={10} aria-hidden="true" />}
    className="border-molten-orange bg-molten-orange font-bold text-zinc-950"
  >
    Sanctioned
  </HeaderPill>
);

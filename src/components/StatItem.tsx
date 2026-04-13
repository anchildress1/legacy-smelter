import type { FC } from 'react';
import { ShieldCheck, TrendingUp, OctagonAlert, type LucideIcon } from 'lucide-react';

const STAT_ICONS: Record<string, LucideIcon> = {
  Sanctions: ShieldCheck,
  Escalations: TrendingUp,
  Breaches: OctagonAlert,
};

interface StatItemProps {
  value: number;
  label: string;
  /** 'inline' (default) for feed cards, 'stacked' for the overlay. */
  variant?: 'inline' | 'stacked';
}

/**
 * Single stat metric (Sanctions / Escalations / Breaches) with
 * responsive icon-vs-label behavior.  Below `sm`, shows the icon;
 * at `sm`+ shows the text label.  Both variants share the same
 * breakpoint so a single change here reflects everywhere.
 */
export const StatItem: FC<StatItemProps> = ({ value, label, variant = 'inline' }) => {
  const Icon = STAT_ICONS[label];

  if (variant === 'stacked') {
    return (
      <div className="text-center">
        <div className="text-ash-white font-mono text-xl sm:text-2xl font-black leading-none">{value}</div>
        {Icon && <Icon size={12} className="sm:hidden mx-auto mt-1 text-ash-white/60" aria-hidden="true" />}
        <div className="hidden sm:block mt-1 text-[9px] font-mono uppercase tracking-[0.15em] text-ash-white/60">{label}</div>
      </div>
    );
  }

  return (
    <span className="flex items-center gap-1" aria-label={`${value} ${label}`}>
      {Icon && <Icon size={14} className="sm:hidden text-ash-white/80" aria-hidden="true" />}
      <span className="text-ash-white font-mono text-sm font-black leading-none">{value}</span>
      <span className="hidden sm:inline text-[9px] font-mono uppercase text-ash-white/60">{label}</span>
    </span>
  );
};

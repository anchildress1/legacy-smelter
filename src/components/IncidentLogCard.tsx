import type { FC, MouseEvent } from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getFiveDistinctColors } from '../lib/utils';
import { Siren, Quote, AlertTriangle, ShieldCheck, TrendingUp, OctagonAlert } from 'lucide-react';
import { useEscalation } from '../hooks/useEscalation';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
  IMPACT_GLOW_FILTER_ESCALATED_BUTTON,
} from '../lib/impactGlow';

interface IncidentLogCardProps {
  log: SmeltLog;
  onClick: () => void;
  showP0Badge?: boolean;
}

export const IncidentLogCard: FC<IncidentLogCardProps> = ({
  log,
  onClick,
  showP0Badge = false,
}) => {
  const { escalated, isToggling, toggle } = useEscalation(log.id);

  const finalColors = getFiveDistinctColors([
    log.color_1, log.color_2, log.color_3, log.color_4, log.color_5,
  ]);

  const impact = computeImpact(log);

  const handleEscalate = (e: MouseEvent) => {
    e.stopPropagation();
    void toggle();
  };

  const escalationStateLabel = escalated ? 'Triggered' : 'Escalate';

  return (
    <div className="modern-card relative overflow-hidden flex w-full text-left hover:border-hazard-amber/40 transition-colors group">
      {/* Left chromatic fingerprint strip */}
      <div
        className="w-2 shrink-0 flex flex-col overflow-hidden saturate-[.95] brightness-[.97]"
        aria-hidden="true"
      >
        {finalColors.map((col) => (
          <div key={col} className="flex-1" style={{ backgroundColor: col }} />
        ))}
      </div>

      {/* Primary action: open incident detail */}
      <button
        onClick={onClick}
        aria-label={`View incident: ${log.legacy_infra_class}`}
        className="p-4 flex-1 min-w-0 cursor-pointer text-left focus-ring-inset"
      >
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-start gap-2 min-w-0">
            <span className="w-2 h-2 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: finalColors[0] }} aria-hidden="true" />
            <p
              className="text-hazard-amber font-mono text-sm uppercase tracking-wide font-black min-w-0 line-clamp-2 min-h-[2lh] leading-snug"
              title={log.legacy_infra_class}
            >
              {log.legacy_infra_class}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="flex items-center justify-center w-5 h-5 rounded bg-hazard-amber/90 text-zinc-950"
              aria-label={`Severity: ${log.severity}`}
            >
              <AlertTriangle size={11} aria-hidden="true" />
            </span>
            {showP0Badge && (
              <span
                className="flex items-center justify-center w-5 h-5 rounded border border-hazard-amber/90 bg-hazard-amber/10 font-mono text-[8px] font-black text-hazard-amber"
                aria-label="P0 Priority"
              >
                P0
              </span>
            )}
            {log.sanctioned && (
              <span
                className="flex items-center justify-center w-5 h-5 rounded bg-molten-orange text-zinc-950"
                aria-label="Sanctioned"
              >
                <ShieldCheck size={11} aria-hidden="true" />
              </span>
            )}
          </div>
        </div>

        <p className="text-ash-white font-mono text-sm leading-snug mt-3 line-clamp-2">
          {log.incident_feed_summary}
        </p>

        <div className="mt-2 flex items-start gap-2 border-l-2 border-hazard-amber/60 pl-2.5">
          <Quote size={12} className="mt-0.5 shrink-0 text-hazard-amber/70" aria-hidden="true" />
          <p
            className="text-xs font-mono italic leading-snug text-hazard-amber/85 line-clamp-2 min-h-[2lh]"
            title={log.share_quote}
          >
            "{log.share_quote}"
          </p>
        </div>

        <div
          className="mt-3 flex items-center gap-3 border-t border-concrete-border pt-3"
          data-testid="incident-card-stats-row"
        >
          <span className="flex items-center gap-1">
            <span
              data-testid="incident-card-impact-number"
              className={`font-mono text-lg font-black leading-none transition-all ${
                escalated ? IMPACT_GLOW_ESCALATED : IMPACT_GLOW_BASE
              }`}
            >
              {impact}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider font-bold text-hazard-amber">Impact</span>
          </span>
          <span className="w-px h-3 bg-concrete-border" aria-hidden="true" />
          {[
            { value: log.sanction_count, label: 'Sanctions', Icon: ShieldCheck },
            { value: log.escalation_count, label: 'Escalations', Icon: TrendingUp },
            { value: log.breach_count, label: 'Breaches', Icon: OctagonAlert },
          ].map(({ value, label, Icon }) => (
            <span key={label} className="flex items-center gap-1" aria-label={`${value} ${label}`}>
              <Icon size={14} className="sm:hidden text-ash-white/80" aria-hidden="true" />
              <span className="text-ash-white font-mono text-sm font-black leading-none">{value}</span>
              <span className="hidden sm:inline text-[9px] font-mono uppercase text-ash-white/60">{label}</span>
            </span>
          ))}
        </div>
      </button>

      {/* Escalate column */}
      <button
        onClick={handleEscalate}
        disabled={isToggling}
        className={`shrink-0 w-16 flex flex-col items-center justify-center gap-1 border-l transition-all focus-ring-inset ${
          escalated
            ? `bg-hazard-amber/15 text-hazard-amber border-l-hazard-amber/30 ${IMPACT_GLOW_FILTER_ESCALATED_BUTTON}`
            : 'border-l-concrete-border text-stone-gray hover:text-hazard-amber hover:bg-hazard-amber/10 hover:border-l-hazard-amber/40'
        } ${isToggling ? 'opacity-50' : ''}`}
        aria-label={escalated ? `Remove escalation for ${log.legacy_infra_class}` : `Escalate ${log.legacy_infra_class}`}
        aria-pressed={escalated}
        title={escalationStateLabel}
      >
        <Siren size={16} aria-hidden="true" />
        <span
          data-testid="incident-card-escalate-state"
          className="font-mono text-[8px] uppercase tracking-[0.18em] font-bold"
        >
          {escalationStateLabel}
        </span>
      </button>
    </div>
  );
};

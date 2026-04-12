import type { FC, MouseEvent } from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getFiveDistinctColors, formatTimestamp } from '../lib/utils';
import { Siren, Quote } from 'lucide-react';
import { useEscalation } from '../hooks/useEscalation';
import { SeverityBadge } from './SeverityBadge';
import { P0Badge } from './P0Badge';
import { SanctionBadge } from './SanctionBadge';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
  IMPACT_GLOW_FILTER_ESCALATED,
} from '../lib/impactGlow';

interface ManifestIncidentCardProps {
  log: SmeltLog;
  onClick: () => void;
  showP0Badge?: boolean;
}

/**
 * Dense manifest card for the full-width incident listing. Designed for
 * scanning — compact vertical footprint, inline metrics, no reserved
 * whitespace. The home-queue uses `IncidentLogCard` (icon-only badges,
 * taller format optimized for the narrow 5-column sidebar).
 */
export const ManifestIncidentCard: FC<ManifestIncidentCardProps> = ({
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
        className="px-4 py-3 flex-1 min-w-0 cursor-pointer text-left focus-ring-inset"
      >
        {/* Row 1: title + badges */}
        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: finalColors[0] }} aria-hidden="true" />
            <p
              className="text-hazard-amber font-mono text-sm uppercase tracking-wide font-black min-w-0 truncate"
              title={log.legacy_infra_class}
            >
              {log.legacy_infra_class}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <SeverityBadge severity={log.severity} />
            {showP0Badge && <P0Badge />}
            {log.sanctioned && <SanctionBadge />}
          </div>
        </div>

        {/* Row 2: summary — single line */}
        <p className="text-ash-white font-mono text-sm leading-snug mt-2 truncate">
          {log.incident_feed_summary}
        </p>

        {/* Row 3: quote — single line */}
        <div className="mt-1.5 flex items-center gap-1.5 border-l-2 border-hazard-amber/60 pl-2.5 min-w-0">
          <Quote size={10} className="shrink-0 text-hazard-amber/70" aria-hidden="true" />
          <p
            className="text-xs font-mono italic leading-snug text-hazard-amber/85 truncate"
            title={log.share_quote}
          >
            "{log.share_quote}"
          </p>
        </div>

        {/* Row 4: inline metrics + timestamp */}
        <div className="mt-2.5 flex items-baseline justify-between gap-4 border-t border-concrete-border pt-2.5">
          <div className="flex items-baseline gap-4" data-testid="manifest-card-stats-row">
            <span className="flex items-baseline gap-1">
              <span
                data-testid="manifest-card-impact-number"
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
              { value: log.sanction_count, label: 'S' },
              { value: log.escalation_count, label: 'E' },
              { value: log.breach_count, label: 'B' },
            ].map(({ value, label }) => (
              <span key={label} className="flex items-baseline gap-1">
                <span className="text-ash-white font-mono text-sm font-black leading-none">{value}</span>
                <span className="text-[9px] font-mono uppercase text-ash-white/60">{label}</span>
              </span>
            ))}
          </div>
          <span className="text-dead-gray font-mono text-xs shrink-0">
            {formatTimestamp(log.timestamp.toDate())}
          </span>
        </div>
      </button>

      {/* Escalate column */}
      <button
        onClick={handleEscalate}
        disabled={isToggling}
        className={`shrink-0 w-14 flex flex-col items-center justify-center gap-1 border-l transition-all focus-ring-inset ${
          escalated
            ? `bg-hazard-amber/15 text-hazard-amber border-l-hazard-amber/30 ${IMPACT_GLOW_FILTER_ESCALATED}`
            : 'border-l-concrete-border text-stone-gray hover:text-hazard-amber hover:bg-hazard-amber/10 hover:border-l-hazard-amber/40'
        } ${isToggling ? 'opacity-50' : ''}`}
        aria-label={escalated ? `Remove escalation for ${log.legacy_infra_class}` : `Escalate ${log.legacy_infra_class}`}
        aria-pressed={escalated}
        title={escalationStateLabel}
      >
        <Siren size={14} aria-hidden="true" />
        <span
          data-testid="manifest-card-escalate-state"
          className="font-mono text-[9px] uppercase tracking-wider font-bold"
        >
          {escalationStateLabel}
        </span>
      </button>
    </div>
  );
};

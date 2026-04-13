import type { FC, MouseEvent } from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getFiveDistinctColors, formatTimestamp } from '../lib/utils';
import { Siren, Quote } from 'lucide-react';
import { useEscalation } from '../hooks/useEscalation';
import { SeverityBadge } from './SeverityBadge';
import { P0Badge } from './P0Badge';
import { SanctionBadge } from './SanctionBadge';
import { IMPACT_GLOW_FILTER_ESCALATED_BUTTON } from '../lib/impactGlow';
import { ChromaticStrip } from './ChromaticStrip';
import { IncidentMetricsRow } from './IncidentMetricsRow';

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
      <ChromaticStrip colors={finalColors} />

      {/* Primary action: open incident detail */}
      <button
        onClick={onClick}
        aria-label={`View incident: ${log.legacy_infra_class}`}
        className="px-4 py-4 flex-1 min-w-0 cursor-pointer text-left focus-ring-inset"
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
        <p className="text-ash-white font-mono text-sm leading-snug mt-2.5 truncate">
          {log.incident_feed_summary}
        </p>

        {/* Row 3: quote — single line */}
        <div className="mt-2 flex items-center gap-1.5 border-l-2 border-hazard-amber/60 pl-2.5 min-w-0">
          <Quote size={10} className="shrink-0 text-hazard-amber/70" aria-hidden="true" />
          <p
            className="text-xs font-mono italic leading-snug text-hazard-amber/85 truncate"
            title={log.share_quote}
          >
            "{log.share_quote}"
          </p>
        </div>

        {/* Row 4: inline metrics + timestamp */}
        <div className="mt-3 flex items-center justify-between gap-4 border-t border-concrete-border pt-3">
          <div className="flex items-center gap-4" data-testid="manifest-card-stats-row">
            <IncidentMetricsRow impact={impact} escalated={escalated} log={log} testIdPrefix="manifest-card" />
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
            ? `bg-hazard-amber/15 text-hazard-amber border-l-hazard-amber/30 ${IMPACT_GLOW_FILTER_ESCALATED_BUTTON}`
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

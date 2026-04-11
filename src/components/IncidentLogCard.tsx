import React from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getFiveDistinctColors, formatTimestamp } from '../lib/utils';
import { Siren, Quote, ShieldCheck } from 'lucide-react';
import { useEscalation } from '../hooks/useEscalation';
import { SeverityBadge } from './SeverityBadge';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
  IMPACT_GLOW_FILTER_ESCALATED,
} from '../lib/impactGlow';

interface IncidentLogCardProps {
  log: SmeltLog;
  onClick: () => void;
}

export const IncidentLogCard: React.FC<IncidentLogCardProps> = ({ log, onClick }) => {
  const { escalated, isToggling, toggle } = useEscalation(log.id);

  const finalColors = getFiveDistinctColors([
    log.color_1, log.color_2, log.color_3, log.color_4, log.color_5,
  ]);

  const impact = computeImpact(log);

  const handleEscalate = (e: React.MouseEvent) => {
    e.stopPropagation();
    void toggle();
  };

  return (
    <div className="modern-card relative overflow-hidden flex w-full text-left hover:border-hazard-amber/40 transition-colors group">
      {/* Left chromatic fingerprint strip. `saturate-75 brightness-90`
          tones down saturation and lightness so dark-palette images
          (where Gemini often returns near-black values that would be
          invisible against the card surface) still show structure
          without overwhelming the title/badge hierarchy. */}
      <div
        className="w-2 shrink-0 flex flex-col saturate-75 brightness-90"
        aria-hidden="true"
      >
        {finalColors.map((col) => (
          <div key={col} className="flex-1" style={{ backgroundColor: col }} />
        ))}
      </div>

      {/* Primary action: open incident detail */}
      <button
        onClick={onClick}
        className="p-4 flex-1 min-w-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset"
      >
        {/* ── HEADER ROW ──
            Fixed right cluster reserves space for all possible badges
            via `invisible` (not display:none) so the title never shifts
            when sanction status changes. */}
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-start gap-2 min-w-0">
            <span className="w-2 h-2 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: finalColors[0] }} aria-hidden="true" />
            {/* Title pinned to exactly two lines (`min-h-[2lh]` reserves
                space for short titles; `line-clamp-2` caps long ones).
                Full text preserved in the native `title` attribute so
                truncated titles are still readable on hover. */}
            <p
              className="text-hazard-amber font-mono text-xs uppercase tracking-widest min-w-0 line-clamp-2 min-h-[2lh]"
              title={log.legacy_infra_class}
            >
              {log.legacy_infra_class}
            </p>
          </div>

          {/* Right cluster: [sanction placeholder] [severity].
              Sanction badge is always rendered; `invisible` hides it
              without collapsing its width, so the cluster width is
              constant regardless of sanction state. */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`inline-flex items-center text-[9px] font-mono font-bold text-zinc-950 bg-hazard-amber/90 px-1 py-0.5 rounded ${log.sanctioned ? '' : 'invisible'}`}
              aria-hidden={!log.sanctioned}
            >
              <ShieldCheck size={8} />
            </span>
            <SeverityBadge severity={log.severity} />
          </div>
        </div>

        {/* Summary — increased top spacing from header (+8px vs prev mt-1) */}
        <p className="text-ash-white font-mono text-sm leading-snug mt-3 line-clamp-2">
          {log.incident_feed_summary}
        </p>

        {/* Quote — tertiary emphasis. Border and text dimmed so it
            doesn't compete with the summary above. Full text preserved
            in the native `title` attribute for hover access. Paragraph
            is pinned to exactly two lines (`min-h-[2lh]` reserves space
            for short quotes; `line-clamp-2` caps long ones) so every
            card in the feed has the same vertical footprint regardless
            of quote length. */}
        <div className="mt-2 flex items-start gap-2 border-l-2 border-hazard-amber/30 pl-2.5">
          <Quote size={12} className="mt-0.5 shrink-0 text-hazard-amber/50" aria-hidden="true" />
          <p
            className="text-xs font-mono italic leading-snug text-hazard-amber/60 line-clamp-2 min-h-[2lh]"
            title={log.share_quote}
          >
            "{log.share_quote}"
          </p>
        </div>

        {/* Metadata — increased top spacing from quote (+4px) */}
        <div className="mt-3 flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-[10px] uppercase tracking-wider">
          {log.sanctioned && (
            <span className="font-bold text-hazard-amber">Sanctioned</span>
          )}
          {/* Impact — the lead derived metric on the card. Carries the
              same warm amber glow defined in `lib/impactGlow` as the
              overlay's Impact number, so the visual treatment is
              identical in both surfaces. Intensifies when escalated. */}
          <span
            className={`font-bold transition-all ${
              escalated ? IMPACT_GLOW_ESCALATED : IMPACT_GLOW_BASE
            }`}
          >
            Impact {impact}
          </span>
          <span className="text-dead-gray text-xs ml-auto">
            {formatTimestamp(log.timestamp.toDate())}
          </span>
        </div>
      </button>

      {/* Escalate — upper-right, header-aligned via `justify-start pt-3.5`
          so the icon sits at the same vertical position as the severity
          badge in the primary content. Full card height provides a touch
          target well above the 44px minimum. `aria-pressed` communicates
          the toggle state to assistive technology. */}
      <button
        onClick={handleEscalate}
        disabled={isToggling}
        className={`shrink-0 w-12 flex flex-col items-center justify-start pt-3.5 gap-1 border-l transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset ${
          escalated
            ? `bg-hazard-amber/15 text-hazard-amber border-l-hazard-amber/30 ${IMPACT_GLOW_FILTER_ESCALATED}`
            : 'border-l-concrete-border text-stone-gray/60 hover:text-hazard-amber hover:bg-hazard-amber/10 hover:border-l-hazard-amber/40'
        } ${isToggling ? 'opacity-50' : ''}`}
        aria-label={escalated ? `Remove escalation for ${log.legacy_infra_class}` : `Escalate ${log.legacy_infra_class}`}
        aria-pressed={escalated}
        title={escalated ? 'De-escalate' : 'Escalate'}
      >
        <Siren size={16} aria-hidden="true" />
      </button>
    </div>
  );
};

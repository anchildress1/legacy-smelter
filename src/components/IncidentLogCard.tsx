import React from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getFiveDistinctColors, formatTimestamp } from '../lib/utils';
import { Siren, AlertTriangle, Quote, ChevronRight } from 'lucide-react';
import { useEscalation } from '../hooks/useEscalation';

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
      {/* Left multicolor strip: preserves the AI "chromatic fingerprint"
          signal but sits at 80% opacity at rest to reduce visual harshness
          during list scans. Restored to full intensity on card hover so the
          palette is readable on intent. Structure (5 bands) is preserved
          per the final rule — only intensity is tuned. */}
      <div
        className="w-2 shrink-0 flex flex-col opacity-80 group-hover:opacity-100 transition-opacity duration-200"
        aria-hidden="true"
      >
        {finalColors.map((col) => (
          <div key={col} className="flex-1" style={{ backgroundColor: col }} />
        ))}
      </div>
      <button
        onClick={onClick}
        className="p-4 flex-1 min-w-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset"
      >
        <div className="flex justify-between items-start gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: finalColors[0] }} aria-hidden="true" />
            <p className="text-hazard-amber font-mono text-xs uppercase tracking-widest min-w-0 truncate">
              {log.legacy_infra_class}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Status badge: brightness nudged down ~10% via `bg-hazard-amber/90`
                so the title reads above the status in the visual hierarchy.
                Color identity preserved — the amber-on-black contrast that
                signals "warning" is still unambiguous. */}
            <span className="font-mono text-[10px] uppercase tracking-wider font-bold bg-hazard-amber/90 text-zinc-950 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
              <AlertTriangle size={10} aria-hidden="true" />
              {log.severity}
            </span>
            {/* Chevron reinforces "this opens" as a navigation hint. Slightly
                more present at rest than before (from `text-dead-gray` to
                `text-stone-gray/50`) so a first-time user sees the affordance
                without needing to hover, then transitions to full amber on
                group hover to make the open action unmistakable. */}
            <ChevronRight
              size={12}
              className="text-stone-gray/50 group-hover:text-hazard-amber group-hover:translate-x-0.5 transition-all duration-200"
              aria-hidden="true"
            />
          </div>
        </div>
        <p className="text-ash-white font-mono text-sm leading-snug mt-1 line-clamp-2">
          {log.incident_feed_summary}
        </p>
        {/* Quote block: clamped to 1 line at rest (down from 2) to reduce
            vertical cost per card, then expands to the full quote on card
            hover. Info is preserved, just deferred behind intent — per the
            "prefer hover to eliminating info" rule. `line-clamp-none` on
            hover removes the webkit-line-clamp cap entirely. */}
        <div className="mt-2 flex items-start gap-2 border-l-2 border-hazard-amber/30 group-hover:border-hazard-amber/50 pl-2.5 transition-colors">
          <Quote size={12} className="mt-0.5 shrink-0 text-hazard-amber/70" aria-hidden="true" />
          <p className="text-xs font-mono italic leading-snug text-hazard-amber/90 line-clamp-1 group-hover:line-clamp-none transition-all duration-200">
            "{log.share_quote}"
          </p>
        </div>
        <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-[10px] uppercase tracking-wider">
          {log.sanctioned && (
            <span className="font-bold text-hazard-amber">Sanctioned</span>
          )}
          <span className="text-stone-gray">Impact {impact}</span>
          <span className="text-stone-gray text-xs ml-auto">
            {formatTimestamp(log.timestamp.toDate())}
          </span>
        </div>
      </button>
      {/* Escalate is a SECONDARY action — it must not compete with card
          click as the primary affordance. Idle state is deliberately
          subdued (`text-stone-gray/35` and a lighter border) so the eye
          lands on the title/status/quote first. Hover state blooms to full
          amber and a background fill so the action is still discoverable
          on intent. Escalated state remains vivid so the armed indicator
          is unambiguous — this is product state, not decoration. */}
      <button
        onClick={handleEscalate}
        disabled={isToggling}
        className={`shrink-0 w-12 flex flex-col items-center justify-center gap-1 border-l transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset ${
          escalated
            ? 'bg-hazard-amber/15 text-hazard-amber border-l-hazard-amber/30'
            : 'border-l-concrete-border/60 text-stone-gray/35 hover:text-hazard-amber hover:bg-hazard-amber/10 hover:border-l-hazard-amber/30'
        } ${isToggling ? 'opacity-50' : ''}`}
        aria-label={escalated ? `Remove escalation for ${log.legacy_infra_class}` : `Escalate ${log.legacy_infra_class}`}
        title={escalated ? 'De-escalate' : 'Escalate'}
      >
        <Siren size={18} />
      </button>
    </div>
  );
};

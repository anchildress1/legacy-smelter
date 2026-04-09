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
      <div className="w-2 shrink-0 flex flex-col" aria-hidden="true">
        {finalColors.map((col, idx) => (
          <div key={idx} className="flex-1" style={{ backgroundColor: col }} />
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
            <span className="font-mono text-[10px] uppercase tracking-wider font-bold bg-hazard-amber text-zinc-950 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
              <AlertTriangle size={10} aria-hidden="true" />
              {log.severity}
            </span>
            <ChevronRight size={12} className="text-dead-gray group-hover:text-stone-gray transition-colors" aria-hidden="true" />
          </div>
        </div>
        <p className="text-ash-white font-mono text-sm leading-snug mt-1 line-clamp-2">
          {log.incident_feed_summary}
        </p>
        <div className="mt-2 flex items-start gap-2 border-l-2 border-hazard-amber/40 pl-2.5">
          <Quote size={12} className="mt-0.5 shrink-0 text-hazard-amber/70" aria-hidden="true" />
          <p className="text-xs font-mono italic leading-snug text-hazard-amber/90 line-clamp-2">
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
      <button
        onClick={handleEscalate}
        disabled={isToggling}
        className={`shrink-0 w-12 flex flex-col items-center justify-center gap-1 border-l border-concrete-border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset ${
          escalated
            ? 'bg-hazard-amber/15 text-hazard-amber border-l-hazard-amber/30'
            : 'text-stone-gray/60 hover:text-hazard-amber/80 hover:bg-hazard-amber/5'
        } ${isToggling ? 'opacity-50' : ''}`}
        aria-label={escalated ? `Remove escalation for ${log.legacy_infra_class}` : `Escalate ${log.legacy_infra_class}`}
        title={escalated ? 'De-escalate' : 'Escalate'}
      >
        <Siren size={18} />
      </button>
    </div>
  );
};

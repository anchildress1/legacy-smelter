import React, { useState, useEffect } from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getFiveDistinctColors, formatTimestamp } from '../lib/utils';
import { Siren, AlertTriangle, Quote } from 'lucide-react';
import { toggleEscalation, hasEscalated, syncEscalationState } from '../services/escalationService';

interface IncidentLogCardProps {
  log: SmeltLog;
  onClick: () => void;
}

export const IncidentLogCard: React.FC<IncidentLogCardProps> = ({ log, onClick }) => {
  const [escalated, setEscalated] = useState(() => hasEscalated(log.id));
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    syncEscalationState(log.id)
      .then((state) => { if (!cancelled) setEscalated(state); })
      .catch((err) => { console.error('[IncidentLogCard] syncEscalationState failed:', err); });
    return () => { cancelled = true; };
  }, [log.id]);

  const finalColors = getFiveDistinctColors([
    log.color_1, log.color_2, log.color_3, log.color_4, log.color_5,
  ]);

  const impact = computeImpact(log.sanction_count, log.escalation_count, log.breach_count);

  const handleEscalate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isToggling) return;
    setIsToggling(true);
    try {
      const wasEscalated = escalated;
      setEscalated(!wasEscalated);
      const newState = await toggleEscalation(log.id);
      if (newState === wasEscalated) {
        setEscalated(wasEscalated);
      }
    } catch (err) {
      console.error('[IncidentLogCard] Escalation failed:', err);
    } finally {
      setIsToggling(false);
    }
  };

  const infraClass = log.legacy_infra_class || 'Incident';

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
        <div className="flex justify-between items-start gap-4">
          {log.legacy_infra_class && (
            <p className="text-hazard-amber font-mono text-xs uppercase tracking-widest min-w-0">
              {log.legacy_infra_class}
            </p>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider font-bold shrink-0 bg-hazard-amber text-zinc-950 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
            <AlertTriangle size={10} aria-hidden="true" />
            {log.severity}
          </span>
        </div>
        <p className="text-ash-white font-mono text-sm leading-snug mt-1 line-clamp-2">
          {log.incident_feed_summary}
        </p>
        {log.share_quote && (
          <div className="mt-2 flex items-start gap-2 border-l-2 border-hazard-amber/40 pl-2.5">
            <Quote size={12} className="mt-0.5 shrink-0 text-hazard-amber/70" aria-hidden="true" />
            <p className="text-xs font-mono italic leading-snug text-hazard-amber/90 line-clamp-2">
              "{log.share_quote}"
            </p>
          </div>
        )}
        <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-[10px] uppercase tracking-wider">
          {log.sanction_count > 0 && (
            <span className="font-bold text-hazard-amber">Sanctioned</span>
          )}
          <span className="text-stone-gray">Impact {impact}</span>
          <span className="text-stone-gray text-xs ml-auto">
            {log.timestamp?.toDate ? formatTimestamp(log.timestamp.toDate()) : '—'}
          </span>
        </div>
      </button>
      <button
        onClick={handleEscalate}
        disabled={isToggling}
        className={`shrink-0 w-12 flex flex-col items-center justify-center gap-1 border-l border-concrete-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset ${
          escalated
            ? 'bg-hazard-amber/15 text-hazard-amber'
            : 'text-dead-gray hover:text-stone-gray hover:bg-concrete-mid/50'
        } ${isToggling ? 'opacity-50' : ''}`}
        aria-label={escalated ? `Remove escalation for ${infraClass}` : `Escalate ${infraClass}`}
        title={escalated ? 'De-escalate' : 'Escalate'}
      >
        <Siren size={18} />
      </button>
    </div>
  );
};

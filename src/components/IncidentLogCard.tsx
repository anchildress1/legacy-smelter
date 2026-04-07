import React, { useState, useEffect } from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getFiveDistinctColors, formatTimestamp } from '../lib/utils';
import { Siren, ShieldCheck } from 'lucide-react';
import { toggleEscalation, hasEscalated, syncEscalationState } from '../services/escalationService';

interface IncidentLogCardProps {
  log: SmeltLog;
  onClick: () => void;
}

export const IncidentLogCard: React.FC<IncidentLogCardProps> = ({ log, onClick }) => {
  const [escalated, setEscalated] = useState(() => hasEscalated(log.id));
  const [isToggling, setIsToggling] = useState(false);
  // Optimistic offset applied immediately on toggle, cleared when Firestore snapshot updates the prop
  const [escalationOffset, setEscalationOffset] = useState(0);
  const prevEscalationCount = React.useRef(log.escalation_count ?? 0);

  useEffect(() => {
    let cancelled = false;
    syncEscalationState(log.id).then((state) => {
      if (!cancelled) setEscalated(state);
    });
    return () => { cancelled = true; };
  }, [log.id]);

  // Clear optimistic offset when the Firestore snapshot delivers a new escalation_count
  useEffect(() => {
    const current = log.escalation_count ?? 0;
    if (current !== prevEscalationCount.current) {
      prevEscalationCount.current = current;
      setEscalationOffset(0);
    }
  }, [log.escalation_count]);

  const finalColors = getFiveDistinctColors([
    log.color_1, log.color_2, log.color_3, log.color_4, log.color_5,
  ]);

  const breaches = log.breach_count ?? 0;
  const escalations = Math.max(0, (log.escalation_count ?? 0) + escalationOffset);
  const impact = computeImpact(escalations, breaches);

  const handleEscalate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isToggling) return;
    setIsToggling(true);
    const wasEscalated = escalated;
    // Optimistic UI update
    setEscalated(!wasEscalated);
    setEscalationOffset((prev) => prev + (wasEscalated ? -1 : 1));
    const newState = await toggleEscalation(log.id);
    // If the server disagreed, revert
    if (newState === wasEscalated) {
      setEscalated(wasEscalated);
      setEscalationOffset((prev) => prev + (wasEscalated ? 1 : -1));
    }
    setIsToggling(false);
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
          <div className="flex items-center gap-1.5 shrink-0">
            {log.audience_favorite && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider font-bold bg-emerald-700/90 text-emerald-100 px-1.5 py-0.5 rounded">
                <ShieldCheck size={10} aria-hidden="true" />
                SANCTIONED
              </span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider font-bold bg-hazard-amber text-zinc-950 px-1.5 py-0.5 rounded">
              {log.severity}
            </span>
          </div>
        </div>
        <p className="text-ash-white font-mono text-sm leading-snug mt-1 line-clamp-3">
          {log.incident_feed_summary}
        </p>
        <div className="mt-2 flex items-end gap-x-4 gap-y-1 flex-wrap">
          <span className="text-molten-orange font-mono text-xs font-bold">
            IMPACT {impact}
          </span>
          <span className="text-hazard-amber font-mono text-xs font-bold">
            {breaches} CONTAINMENT
          </span>
          <span className="text-hazard-amber font-mono text-xs font-bold">
            {escalations} ESCALATIONS
          </span>
          <span className="text-stone-gray font-mono text-xs ml-auto">
            {log.timestamp?.toDate ? formatTimestamp(log.timestamp.toDate()) : '—'}
          </span>
        </div>
      </button>
      <button
        onClick={handleEscalate}
        disabled={isToggling}
        className={`shrink-0 w-12 flex flex-col items-center justify-center gap-1 border-l border-concrete-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset ${
          escalated
            ? 'bg-molten-orange/15 text-molten-orange'
            : 'text-dead-gray hover:text-stone-gray hover:bg-concrete-mid/50'
        } ${isToggling ? 'opacity-50' : ''}`}
        aria-label={escalated ? `Remove escalation for ${infraClass}` : `Escalate ${infraClass}`}
        title={escalated ? 'De-escalate' : 'Escalate'}
      >
        <Siren size={18} className={escalated ? 'animate-pulse' : ''} />
        <span className="font-mono text-[10px] font-bold">{escalations}</span>
      </button>
    </div>
  );
};

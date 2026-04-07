import React from 'react';
import { SmeltLog } from '../types';
import { getFiveDistinctColors, formatTimestamp } from '../lib/utils';

interface IncidentLogCardProps {
  log: SmeltLog;
  onClick: () => void;
}

export const IncidentLogCard: React.FC<IncidentLogCardProps> = ({ log, onClick }) => {
  const finalColors = getFiveDistinctColors([
    log.color_1, log.color_2, log.color_3, log.color_4, log.color_5,
  ]);

  return (
    <button
      onClick={onClick}
      className="modern-card relative overflow-hidden flex w-full text-left hover:border-hazard-amber/40 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber"
    >
      <div className="w-2 shrink-0 flex flex-col" aria-hidden="true">
        {finalColors.map((col, idx) => (
          <div key={idx} className="flex-1" style={{ backgroundColor: col }} />
        ))}
      </div>
      <div className="p-4 flex-1 min-w-0">
        <div className="flex justify-between items-start gap-4">
          {log.legacy_infra_class && (
            <p className="text-hazard-amber font-mono text-xs uppercase tracking-widest min-w-0">
              {log.legacy_infra_class}
            </p>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider font-bold shrink-0 bg-hazard-amber text-zinc-950 px-1.5 py-0.5 rounded">
            {log.severity}
          </span>
        </div>
        <p className="text-ash-white font-mono text-sm leading-snug mt-1 line-clamp-3">
          {log.incident_feed_summary}
        </p>
        <div className="mt-2 flex items-end gap-x-5 gap-y-1 flex-wrap">
          <span className="text-hazard-amber font-mono text-xs font-bold">
            {log.breach_count ?? 0} CONTAINMENT BREACHES
          </span>
          <span className="text-stone-gray font-mono text-xs ml-auto">
            {log.timestamp?.toDate ? formatTimestamp(log.timestamp.toDate()) : '—'}
          </span>
        </div>
      </div>
    </button>
  );
};

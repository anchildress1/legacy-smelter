import React from 'react';
import { SmeltLog } from '../types';
import { formatPixels, getFiveDistinctColors } from '../lib/utils';

interface SmeltManifestProps {
  logs: SmeltLog[];
}

export const SmeltManifest: React.FC<SmeltManifestProps> = ({ logs }) => {
  return (
    <div className="space-y-4">
      <h2 className="text-hazard-amber font-mono text-xl uppercase tracking-widest border-b-2 border-concrete-border pb-2">
        GLOBAL INCIDENT MANIFEST
      </h2>
      <div className="space-y-4">
        {logs.map((log) => {
          const formatted = formatPixels(log.pixel_count);
          const rawColors = [log.color_1, log.color_2, log.color_3, log.color_4, log.color_5];
          const finalColors = getFiveDistinctColors(rawColors);

          return (
            <div
              key={log.id}
              className="modern-card p-4 flex gap-4 relative overflow-hidden"
            >
              <div className="w-4 h-full absolute left-0 top-0 flex flex-col">
                {finalColors.map((col, idx) => (
                  <div key={idx} className="flex-1 w-full" style={{ backgroundColor: col }} />
                ))}
              </div>
              <div className="pl-4 flex-1">
                {log.legacy_infra_class && (
                  <p className="text-hazard-amber font-mono text-[10px] uppercase tracking-widest mb-1">
                    {log.legacy_infra_class}
                  </p>
                )}
                <p className="text-ash-white font-mono text-sm leading-tight">
                  {log.incident_feed_summary}
                </p>
                <div className="mt-2 flex justify-between items-end">
                  <span className="text-hazard-amber font-mono text-xs font-bold">
                    {formatted.value} {formatted.unit} THERMALLY DECOMMISSIONED
                  </span>
                  <span className="text-stone-gray font-mono text-[10px]">
                    {new Date(log.timestamp?.toDate?.() || Date.now()).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {logs.length === 0 && (
          <div className="text-stone-gray font-mono text-center py-8 italic">
            NO INCIDENTS ON RECORD. FURNACE IDLE.
          </div>
        )}
      </div>
    </div>
  );
};

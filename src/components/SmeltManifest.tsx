import React from 'react';
import { SmeltLog } from '../types';
import { cn } from '../lib/utils';

interface SmeltManifestProps {
  logs: SmeltLog[];
}

export const SmeltManifest: React.FC<SmeltManifestProps> = ({ logs }) => {
  return (
    <div className="space-y-4">
      <h2 className="text-steel-blue font-mono text-xl uppercase tracking-widest border-b-2 border-zinc-800 pb-2">
        GLOBAL SMELTING LOG
      </h2>
      <div className="space-y-4">
        {logs.map((log) => (
          <div 
            key={log.id} 
            className="modern-card p-4 flex gap-4 relative overflow-hidden"
          >
            <div 
              className="w-4 h-full absolute left-0 top-0" 
              style={{ backgroundColor: log.dominant_colors[0] }}
            />
            <div className="pl-4 flex-1">
              <p className="text-zinc-300 font-mono text-sm leading-tight">
                {log.damage_report}
              </p>
              <div className="mt-2 flex justify-between items-end">
                <span className="text-hazard-yellow font-mono text-xs font-bold">
                  {log.pixel_count.toLocaleString()} PX SMELTED
                </span>
                <span className="text-zinc-500 font-mono text-[10px]">
                  {new Date(log.timestamp?.toDate?.() || Date.now()).toLocaleTimeString()}
                </span>
              </div>
            </div>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-zinc-600 font-mono text-center py-8 italic">
            NO SMELTING DETECTED. SYSTEM IDLE.
          </div>
        )}
      </div>
    </div>
  );
};

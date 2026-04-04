import React from 'react';
import { SmeltLog } from '../types';
import { cn } from '../lib/utils';

interface SlagManifestProps {
  logs: SmeltLog[];
}

export const SlagManifest: React.FC<SlagManifestProps> = ({ logs }) => {
  return (
    <div className="space-y-4">
      <h2 className="text-acid-green font-mono text-xl uppercase tracking-widest border-b-2 border-acid-green pb-2">
        [ THE SLAG MANIFEST ]
      </h2>
      <div className="space-y-4">
        {logs.map((log) => (
          <div 
            key={log.id} 
            className="brutalist-card p-4 flex gap-4 relative overflow-hidden"
          >
            <div 
              className="w-4 h-full absolute left-0 top-0" 
              style={{ backgroundColor: log.dominant_colors[0] }}
            />
            <div className="pl-4 flex-1">
              <p className="text-acid-green font-mono text-sm leading-tight">
                {log.damage_report}
              </p>
              <div className="mt-2 flex justify-between items-end">
                <span className="text-neon-pink font-mono text-xs font-bold">
                  {log.pixel_count.toLocaleString()} PX REDUCED
                </span>
                <span className="text-gray-500 font-mono text-[10px]">
                  {new Date(log.timestamp?.toDate?.() || Date.now()).toLocaleTimeString()}
                </span>
              </div>
            </div>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-gray-600 font-mono text-center py-8 italic">
            NO SLAG DETECTED. SYSTEM IDLE.
          </div>
        )}
      </div>
    </div>
  );
};

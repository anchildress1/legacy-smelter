import React from 'react';
import { formatPixels } from '../lib/utils';

interface GlobalStatsProps {
  totalPixels: number;
}

export const GlobalStats: React.FC<GlobalStatsProps> = ({ totalPixels }) => {
  const formatted = formatPixels(totalPixels);

  return (
    <div className="modern-card p-6 relative overflow-hidden">
      <div className="hazard-stripe h-2 absolute top-0 left-0 w-full" />
      <div className="mt-2">
        <h3 className="neon-label text-acid-green font-mono text-xs uppercase tracking-widest mb-1">
          GLOBAL SMELT ACCUMULATION
        </h3>
        <div className="text-4xl font-extrabold font-mono text-steel-blue tracking-tighter">
          {formatted.value}
          <span className="text-sm ml-2 text-zinc-500">{formatted.unit}</span>
        </div>
      </div>
      <div className="mt-4 flex gap-2 items-center">
        <div className="w-2 h-2 rounded-full bg-hazard-yellow animate-pulse" />
        <div className="text-[10px] font-mono text-zinc-500 uppercase">
          SYSTEM STATUS: OPERATIONAL // SMELTER READY
        </div>
      </div>
    </div>
  );
};

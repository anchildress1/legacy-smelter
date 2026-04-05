import React from 'react';
import { formatPixels } from '../lib/utils';

interface GlobalStatsProps {
  totalPixels: number;
}

export const GlobalStats: React.FC<GlobalStatsProps> = ({ totalPixels }) => {
  const formatted = formatPixels(totalPixels);

  return (
    <div className="modern-card p-6 relative overflow-hidden">
      <div className="hazard-stripe h-1.5 absolute top-0 left-0 w-full" />
      <div className="mt-2">
        <h2 className="text-hazard-amber font-mono text-[10px] uppercase tracking-widest mb-1">
          CUMULATIVE THERMAL DESTRUCTION INDEX
        </h2>
        <div className="text-4xl font-extrabold font-mono text-hazard-amber tracking-tighter">
          {formatted.value}
          <span className="text-sm ml-2 text-stone-gray">{formatted.unit}</span>
        </div>
      </div>
      <div className="mt-4 flex gap-2 items-center">
        <div className="w-2 h-2 rounded-full bg-coolant-green animate-pulse" />
        <div className="text-[10px] font-mono text-stone-gray uppercase">
          FURNACE STATUS: NOMINAL // AWAITING DIRECTIVES
        </div>
      </div>
    </div>
  );
};

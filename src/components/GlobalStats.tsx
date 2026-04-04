import React from 'react';

interface GlobalStatsProps {
  totalPixels: number;
}

export const GlobalStats: React.FC<GlobalStatsProps> = ({ totalPixels }) => {
  return (
    <div className="brutalist-card p-6 bg-black border-acid-green relative overflow-hidden">
      <div className="hazard-stripe h-4 absolute top-0 left-0 w-full" />
      <div className="mt-4">
        <h3 className="text-acid-green font-mono text-xs uppercase tracking-widest mb-1">
          GLOBAL SLAG ACCUMULATION
        </h3>
        <div className="text-4xl font-extrabold font-mono text-neon-pink tracking-tighter">
          {totalPixels.toLocaleString()}
          <span className="text-sm ml-2 text-acid-green">PX</span>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <div className="w-2 h-2 bg-acid-green animate-pulse" />
        <div className="text-[10px] font-mono text-gray-500 uppercase">
          SYSTEM STATUS: OPERATIONAL // SMELTER READY
        </div>
      </div>
    </div>
  );
};

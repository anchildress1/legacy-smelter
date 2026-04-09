import React from 'react';
import { formatPixels } from '../lib/utils';

interface DecommissionIndexProps {
  totalPixels: number;
}

export const DecommissionIndex: React.FC<DecommissionIndexProps> = ({ totalPixels }) => {
  const formatted = formatPixels(totalPixels);
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <div className="font-mono font-extrabold text-hazard-amber text-lg leading-none tracking-tight">
          {formatted.value} <span className="text-xs text-stone-gray font-bold">{formatted.unit}</span>
        </div>
        <div className="text-[10px] font-mono text-stone-gray uppercase tracking-widest mt-0.5">
          DECOMMISSION INDEX
        </div>
      </div>
      <div className="hazard-stripe w-2 h-10 rounded-sm shrink-0" aria-hidden="true" />
    </div>
  );
};

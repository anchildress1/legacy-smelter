import type { FC } from 'react';
import { formatPixels } from '../lib/utils';

const UNIT_ABBREV: Record<string, string> = {
  PIXELS: 'PX',
  KILOPIXELS: 'KP',
  MEGAPIXELS: 'MP',
  GIGAPIXELS: 'GP',
  TERAPIXELS: 'TP',
  PETAPIXELS: 'PP',
};

interface DecommissionIndexProps {
  totalPixels: number;
}

export const DecommissionIndex: FC<DecommissionIndexProps> = ({ totalPixels }) => {
  const formatted = formatPixels(totalPixels);
  const shortUnit = UNIT_ABBREV[formatted.unit] ?? formatted.unit;
  return (
    <div className="flex items-center gap-1.5 sm:gap-3">
      <div className="text-right">
        <div className="font-mono font-extrabold text-hazard-amber text-xs sm:text-lg leading-none tracking-tight">
          {formatted.value}
          <span className="sm:hidden text-[8px] text-stone-gray font-bold ml-0.5">{shortUnit}</span>
          <span className="hidden sm:inline text-xs text-stone-gray font-bold ml-1">{formatted.unit}</span>
        </div>
        <div className="text-[7px] sm:text-[10px] font-mono text-stone-gray uppercase tracking-widest mt-0.5">
          DECOMMISSION INDEX
        </div>
      </div>
      <div className="hazard-stripe w-1 sm:w-2 h-6 sm:h-10 rounded-sm shrink-0" aria-hidden="true" />
    </div>
  );
};

import type { FC } from 'react';

interface ChromaticStripProps {
  colors: string[];
}

export const ChromaticStrip: FC<ChromaticStripProps> = ({ colors }) => (
  <div
    className="w-2 shrink-0 flex flex-col overflow-hidden saturate-[.95] brightness-[.97]"
    aria-hidden="true"
  >
    {colors.map((col) => (
      <div key={col} className="flex-1" style={{ backgroundColor: col }} />
    ))}
  </div>
);

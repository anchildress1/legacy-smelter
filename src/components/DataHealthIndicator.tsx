import React, { useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface DataHealthIndicatorProps {
  readonly issues: readonly string[];
}

// This is a disclosure panel (button toggles an inline status list),
// not a modal dialog — no focus trap, no backdrop, no separate semantic
// region. The correct ARIA pattern is `aria-expanded` + `aria-controls`
// on the toggle and a plain region for the content. `role="dialog"`
// would lie about the semantics and trip SonarCloud S6819.
export const DataHealthIndicator: React.FC<DataHealthIndicatorProps> = ({ issues }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (issues.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded border border-hazard-amber/40 bg-hazard-amber/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-hazard-amber hover:bg-hazard-amber/15 focus-ring"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <AlertTriangle size={12} aria-hidden="true" />
        Data Degraded
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded border border-hazard-amber/30 bg-concrete-mid p-3 shadow-2xl z-[120]"
        >
          <ul className="space-y-2">
            {issues.map((message) => (
              <li key={message} className="text-hazard-amber font-mono text-[10px] uppercase tracking-wide leading-relaxed">
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

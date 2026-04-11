import React from 'react';

/**
 * Single source of truth for the "P0" priority badge rendered in the
 * incident card header and the overlay title row whenever an incident
 * is in the live top-3 set. Padding and text size match `SeverityBadge`
 * and the overlay's Escalate button (`px-2 py-1.5 text-[10px]`) so the
 * three sit at identical height in the same cluster. The outlined
 * treatment (border + 10% fill) keeps it visually distinct from the
 * filled severity pill without breaking the cluster's box model.
 *
 * The badge renders the literal text "P0" as a `<span>` with a
 * `text-hazard-amber` class; both are pinned by `IncidentLogCard.test.tsx`
 * and `IncidentReportOverlay.test.tsx`. A refactor that changes the
 * tag or drops the text colour must update those tests on purpose.
 */
export const P0Badge: React.FC = () => {
  return (
    <span className="inline-flex items-center rounded border border-hazard-amber/90 bg-hazard-amber/10 px-2 py-1.5 font-mono text-[10px] font-black uppercase tracking-wider text-hazard-amber">
      P0
    </span>
  );
};

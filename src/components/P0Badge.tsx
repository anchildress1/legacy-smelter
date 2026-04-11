import type { FC } from 'react';
import { HeaderPill } from './HeaderPill';

/**
 * Static "P0" priority badge rendered in the incident card header and the
 * overlay title row whenever an incident is in the live top-3 set. Delegates
 * all box-model concerns (padding, text size, border) to `HeaderPill` so the
 * three siblings (P0, severity, escalate) share a single source of truth and
 * cannot drift apart visually.
 *
 * The badge renders the literal text "P0" as a `<span>` with a
 * `text-hazard-amber` class; both are pinned by `IncidentLogCard.test.tsx`
 * and `IncidentReportOverlay.test.tsx`. A refactor that changes the tag or
 * drops the text colour must update those tests on purpose.
 */
export const P0Badge: FC = () => (
  <HeaderPill className="border-hazard-amber/90 bg-hazard-amber/10 font-black text-hazard-amber">
    P0
  </HeaderPill>
);

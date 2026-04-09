import type { Timestamp } from 'firebase/firestore';

export interface SmeltLog {
  id: string;
  impact_score: number;
  pixel_count: number;
  incident_feed_summary: string;
  color_1: string;
  color_2: string;
  color_3: string;
  color_4: string;
  color_5: string;
  subject_box_ymin: number;
  subject_box_xmin: number;
  subject_box_ymax: number;
  subject_box_xmax: number;
  legacy_infra_class: string;
  diagnosis: string;
  chromatic_profile: string;
  system_dx: string;
  severity: string;
  primary_contamination: string;
  contributing_factor: string;
  failure_origin: string;
  disposition: string;
  archive_note: string;
  og_headline: string;
  share_quote: string;
  anon_handle: string;
  timestamp: Timestamp;
  uid: string;
  breach_count: number;
  escalation_count: number;
  sanction_count: number;
  judged: boolean;
  sanctioned: boolean;
  sanction_rationale: string | null;
}

export interface GlobalStats {
  total_pixels_melted: number;
}

/**
 * Counter subset used by `computeImpact`. Field names intentionally match
 * `SmeltLog` (snake_case) so `computeImpact(log)` works via structural
 * subtyping without an adapter. Do NOT propagate this convention to other
 * helper types.
 */
export type ImpactCounts = Pick<SmeltLog, 'sanction_count' | 'escalation_count' | 'breach_count'>;

/** Impact = (5 × sanctions) + (3 × escalations) + (2 × breaches), each clamped to 0 */
export function computeImpact(counts: ImpactCounts): number {
  const s = Math.max(0, counts.sanction_count);
  const e = Math.max(0, counts.escalation_count);
  const b = Math.max(0, counts.breach_count);
  return 5 * s + 3 * e + 2 * b;
}

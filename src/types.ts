import type { Timestamp } from 'firebase/firestore';

export type Severity = string;

export interface SmeltLog {
  id: string;
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
  severity: Severity;
  primary_contamination: string;
  contributing_factor: string;
  failure_origin: string;
  disposition: string;
  archive_note: string;
  og_headline: string;
  share_quote: string;
  anon_handle: string;
  timestamp: Timestamp | null;
  uid: string;
  breach_count?: number;
  escalation_count?: number;
  sanction_count?: number;
  judged?: boolean;
  sanctioned?: boolean;
  sanction_rationale?: string | null;
}

export interface GlobalStats {
  total_pixels_melted: number;
}

/** SmeltLog with all optional voting fields resolved to concrete values. */
export type NormalizedSmeltLog = SmeltLog & {
  breach_count: number;
  escalation_count: number;
  sanction_count: number;
  judged: boolean;
  sanctioned: boolean;
  sanction_rationale: string | null;
};

/** Defaults for optional voting fields that may be absent on old documents. */
export function withVotingDefaults(log: SmeltLog): NormalizedSmeltLog {
  const isSanctioned = log.sanctioned ?? ((log.sanction_count ?? 0) > 0);
  return {
    ...log,
    breach_count: log.breach_count ?? 0,
    escalation_count: log.escalation_count ?? 0,
    sanction_count: log.sanction_count ?? (isSanctioned ? 1 : 0),
    judged: log.judged ?? false,
    sanctioned: isSanctioned,
    sanction_rationale: log.sanction_rationale ?? null,
  };
}

/** Impact = (5 × sanctions) + (3 × escalations) + (2 × breaches), clamped to 0 */
export function computeImpact(sanctionCount: number, escalationCount: number, breachCount: number): number {
  return Math.max(0, (5 * sanctionCount) + (3 * escalationCount) + (2 * breachCount));
}

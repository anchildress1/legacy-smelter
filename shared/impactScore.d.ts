export declare const IMPACT_WEIGHTS: Readonly<{
  sanction: 5;
  escalation: 3;
  breach: 2;
}>;

export declare function computeImpactScore(counts: {
  sanction_count: number;
  escalation_count: number;
  breach_count: number;
}): number;

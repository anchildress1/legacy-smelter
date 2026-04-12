import type { SmeltAnalysis } from '../services/geminiService';
import type { SmeltLog } from '../types';
import { computeImpact } from '../types';
import { formatTimestamp, getFiveDistinctColors } from './utils';

export interface IncidentReportModel {
  legacyInfraClass: string;
  incidentFeedSummary: string;
  severity: string;
  diagnosis: string;
  failureOrigin: string;
  primaryContamination: string;
  contributingFactor: string;
  disposition: string;
  archiveNote: string;
  shareQuote: string;
  anonHandle: string;
  chromaticProfile: string;
  dominantColors: string[];
  sanctionCount: number;
  breachCount: number;
  escalationCount: number;
  sanctioned: boolean;
  sanctionRationale: string | null;
  timestamp: Date | null;
}

export function buildIncidentReportMarkdown(
  report: IncidentReportModel,
  liveBreachCount: number,
  liveEscalationCount: number,
  liveSanctionCount: number,
  liveTimestamp: Date | null,
): string {
  const liveCounts = {
    sanction_count: liveSanctionCount,
    escalation_count: liveEscalationCount,
    breach_count: liveBreachCount,
  };
  const impact = computeImpact(liveCounts);

  // ── Section 1: Incident Overview ──
  const lines: string[] = [
    `# ${report.legacyInfraClass}`,
    '',
    `**${report.severity}** · Impact ${impact} · Sanctions ${liveSanctionCount} · Escalations ${liveEscalationCount} · Breaches ${liveBreachCount}`,
    '',
    report.incidentFeedSummary,
  ];

  if (report.shareQuote) {
    lines.push('', `> "${report.shareQuote}"`);
  }

  // ── Section 2: Recommended Action ──
  lines.push(
    '',
    '## Recommended Action',
    '',
    report.disposition,
  );

  // ── Section 3: Diagnostics ──
  const diagnostics = [
    report.primaryContamination
      ? `**Primary Contaminant:** ${report.primaryContamination}`
      : null,
    report.contributingFactor
      ? `**Contributing Factor:** ${report.contributingFactor}`
      : null,
    report.diagnosis ? `**Diagnosis:** ${report.diagnosis}` : null,
    report.failureOrigin ? `**Failure Origin:** ${report.failureOrigin}` : null,
  ].filter((s): s is string => s !== null);

  if (diagnostics.length > 0) {
    lines.push('', '---', '', '## Diagnostics', '', ...diagnostics);
  }

  // ── Section 4: Archive ──
  lines.push(
    '',
    '---',
    '',
    '## Archive Note',
    '',
    report.archiveNote,
  );

  if (liveSanctionCount > 0 && report.sanctionRationale) {
    lines.push(
      '',
      `**Sanction Rationale:** ${report.sanctionRationale}`,
    );
  }

  // ── Footer ──
  const footerParts = [`Filed by ${report.anonHandle}`];
  if (liveTimestamp) footerParts.push(formatTimestamp(liveTimestamp));
  footerParts.push(`Chromatic profile: ${report.chromaticProfile}`);
  lines.push('', '---', '', `*${footerParts.join(' · ')}*`);

  return lines.join('\n');
}

export function normalizeIncidentReport(
  analysis?: SmeltAnalysis | null,
  log?: SmeltLog | null,
): IncidentReportModel | null {
  if (analysis) {
    return {
      legacyInfraClass: analysis.legacyInfraClass,
      incidentFeedSummary: analysis.incidentFeedSummary,
      severity: analysis.severity,
      diagnosis: analysis.diagnosis,
      failureOrigin: analysis.failureOrigin,
      primaryContamination: analysis.primaryContamination,
      contributingFactor: analysis.contributingFactor,
      disposition: analysis.disposition,
      archiveNote: analysis.archiveNote,
      shareQuote: analysis.shareQuote,
      anonHandle: analysis.anonHandle,
      chromaticProfile: analysis.chromaticProfile,
      dominantColors: analysis.dominantColors,
      sanctionCount: 0,
      breachCount: 0,
      escalationCount: 0,
      sanctioned: false,
      sanctionRationale: null,
      timestamp: null,
    };
  }
  if (log) {
    return {
      legacyInfraClass: log.legacy_infra_class,
      incidentFeedSummary: log.incident_feed_summary,
      severity: log.severity,
      diagnosis: log.diagnosis,
      failureOrigin: log.failure_origin,
      primaryContamination: log.primary_contamination,
      contributingFactor: log.contributing_factor,
      disposition: log.disposition,
      archiveNote: log.archive_note,
      shareQuote: log.share_quote,
      anonHandle: log.anon_handle,
      chromaticProfile: log.chromatic_profile,
      dominantColors: getFiveDistinctColors([
        log.color_1,
        log.color_2,
        log.color_3,
        log.color_4,
        log.color_5,
      ]),
      sanctionCount: log.sanction_count,
      breachCount: log.breach_count,
      escalationCount: log.escalation_count,
      sanctioned: log.sanctioned,
      sanctionRationale: log.sanction_rationale,
      timestamp: log.timestamp.toDate(),
    };
  }
  return null;
}

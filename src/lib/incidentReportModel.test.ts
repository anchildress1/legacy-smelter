import { describe, expect, it } from 'vitest';
import {
  buildIncidentReportMarkdown,
  normalizeIncidentReport,
} from './incidentReportModel';
import type { IncidentReportModel } from './incidentReportModel';
import type { SmeltAnalysis } from '../services/geminiService';
import { makeFixtureLog } from '../test/smeltLogFixtures';

/**
 * The incident report drives the overlay's markdown rendering and
 * the sharable postmortem copy. The "live counts" separation is
 * load-bearing: the card's impact number must reflect optimistic
 * user interactions (breach/escalate) instead of the stored Firestore
 * value, so `buildIncidentReportMarkdown` takes live counts as
 * explicit args. Pin that contract here.
 */

function makeModel(overrides: Partial<IncidentReportModel> = {}): IncidentReportModel {
  return {
    legacyInfraClass: 'Class',
    incidentFeedSummary: 'Summary',
    severity: 'HIGH',
    diagnosis: 'Diagnosis',
    failureOrigin: 'Origin',
    primaryContamination: 'Primary',
    contributingFactor: 'Contributing',
    disposition: 'Disp',
    archiveNote: 'Archive',
    shareQuote: 'Quote',
    anonHandle: 'handle',
    chromaticProfile: 'Profile',
    dominantColors: ['#ff0000', '#00ff00'],
    sanctionCount: 0,
    breachCount: 0,
    escalationCount: 0,
    sanctioned: false,
    sanctionRationale: null,
    timestamp: null,
    ...overrides,
  };
}

describe('buildIncidentReportMarkdown', () => {
  it('computes impact from live counts rather than the stored model counters', () => {
    const markdown = buildIncidentReportMarkdown(makeModel(), 1, 1, 1, null);
    expect(markdown).toContain('Impact 10');
    expect(markdown).toContain('Sanctions 1');
    expect(markdown).toContain('Escalations 1');
    expect(markdown).toContain('Breaches 1');
  });

  it('renders sections in overlay order: title → summary → quote → action → diagnostics → archive', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({
        legacyInfraClass: 'Phoenix IV',
        incidentFeedSummary: 'Core meltdown',
        disposition: 'Decommission',
        diagnosis: 'Thermal overrun',
        archiveNote: 'Sealed',
      }),
      0, 0, 0, null,
    );
    const heading = markdown.indexOf('# Phoenix IV');
    const summary = markdown.indexOf('Core meltdown');
    const action = markdown.indexOf('## Recommended Action');
    const diagnostics = markdown.indexOf('## Diagnostics');
    const archive = markdown.indexOf('## Archive Note');
    expect(heading).toBeLessThan(summary);
    expect(summary).toBeLessThan(action);
    expect(action).toBeLessThan(diagnostics);
    expect(diagnostics).toBeLessThan(archive);
  });

  it('renders the share quote as a blockquote when present', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ shareQuote: 'quote one' }),
      0, 0, 0, null,
    );
    expect(markdown).toContain('> "quote one"');
  });

  it('omits the share-quote blockquote when the quote is empty', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ shareQuote: '' }),
      0, 0, 0, null,
    );
    expect(markdown).not.toContain('> ');
  });

  it('includes the filed timestamp in the footer when liveTimestamp is provided', () => {
    const withTs = buildIncidentReportMarkdown(
      makeModel(),
      0, 0, 0,
      new Date('2026-04-10T00:00:00Z'),
    );
    expect(withTs).toMatch(/Filed by handle · .+ · Chromatic profile: Profile/);
    const noTs = buildIncidentReportMarkdown(makeModel(), 0, 0, 0, null);
    expect(noTs).toContain('Filed by handle · Chromatic profile: Profile');
  });

  it('renders the Diagnostics section only when at least one field is non-empty', () => {
    const withAll = buildIncidentReportMarkdown(
      makeModel({
        failureOrigin: 'o',
        primaryContamination: 'p',
        contributingFactor: 'c',
        diagnosis: 'd',
      }),
      0, 0, 0, null,
    );
    expect(withAll).toContain('## Diagnostics');
    expect(withAll).toContain('**Primary Contaminant:** p');
    expect(withAll).toContain('**Contributing Factor:** c');
    expect(withAll).toContain('**Diagnosis:** d');
    expect(withAll).toContain('**Failure Origin:** o');

    const noneSet = buildIncidentReportMarkdown(
      makeModel({ failureOrigin: '', primaryContamination: '', contributingFactor: '', diagnosis: '' }),
      0, 0, 0, null,
    );
    expect(noneSet).not.toContain('## Diagnostics');
  });

  it('always includes Recommended Action and Archive Note sections', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ disposition: 'shipped', archiveNote: 'archived' }),
      0, 0, 0, null,
    );
    expect(markdown).toContain('## Recommended Action');
    expect(markdown).toContain('shipped');
    expect(markdown).toContain('## Archive Note');
    expect(markdown).toContain('archived');
  });

  it('includes sanction rationale when sanctioned', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ sanctionRationale: 'Earned it.' }),
      0, 0, 1, null,
    );
    expect(markdown).toContain('**Sanction Rationale:** Earned it.');
  });

  it('omits sanction rationale when not sanctioned', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ sanctionRationale: 'Earned it.' }),
      0, 0, 0, null,
    );
    expect(markdown).not.toContain('Sanction Rationale');
  });

  it('renders the filed-by footer with anonHandle and chromaticProfile', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ anonHandle: 'ghost-42', chromaticProfile: 'amber-rust' }),
      0, 0, 0, null,
    );
    expect(markdown).toContain('Filed by ghost-42');
    expect(markdown).toContain('amber-rust');
  });
});

describe('normalizeIncidentReport', () => {
  function makeAnalysis(): SmeltAnalysis {
    return {
      legacyInfraClass: 'Class',
      diagnosis: 'diag',
      dominantColors: ['#ff0000', '#00ff00'],
      chromaticProfile: 'profile',
      severity: 'HIGH',
      primaryContamination: 'primary',
      contributingFactor: 'contrib',
      failureOrigin: 'origin',
      disposition: 'disp',
      incidentFeedSummary: 'summary',
      archiveNote: 'archive',
      ogHeadline: 'headline',
      shareQuote: 'quote',
      anonHandle: 'handle',
      pixelCount: 100,
      subjectBox: [0, 0, 100, 100],
      incidentId: 'doc-1',
    };
  }

  it('prefers the analysis over the log when both are provided', () => {
    // App.tsx passes both during the post-analyze render before the
    // Firestore snapshot arrives — analysis wins so the UI reflects
    // the just-uploaded response without a flash of stale data.
    const report = normalizeIncidentReport(makeAnalysis(), makeFixtureLog('log-1'));
    expect(report?.legacyInfraClass).toBe('Class');
    expect(report?.dominantColors).toEqual(['#ff0000', '#00ff00']);
    // Log-only fields must NOT leak through — zero counters and null
    // sanction fields are the analysis contract.
    expect(report?.sanctionCount).toBe(0);
    expect(report?.sanctionRationale).toBeNull();
    expect(report?.sanctioned).toBe(false);
    expect(report?.timestamp).toBeNull();
  });

  it('falls back to the log when analysis is absent', () => {
    const log = makeFixtureLog('log-2', {
      legacy_infra_class: 'Phoenix',
      sanction_count: 1,
      sanctioned: true,
      sanction_rationale: 'stood out',
    });
    const report = normalizeIncidentReport(null, log);
    expect(report?.legacyInfraClass).toBe('Phoenix');
    expect(report?.sanctionCount).toBe(1);
    expect(report?.sanctioned).toBe(true);
    expect(report?.sanctionRationale).toBe('stood out');
    expect(report?.timestamp).toBeInstanceOf(Date);
    // The five colors come via `getFiveDistinctColors` so duplicates or
    // invalid entries still produce a 5-element array.
    expect(report?.dominantColors).toHaveLength(5);
  });

  it('returns null when both analysis and log are null', () => {
    expect(normalizeIncidentReport(null, null)).toBeNull();
  });

  it('returns null when both analysis and log are undefined', () => {
    expect(normalizeIncidentReport(undefined, undefined)).toBeNull();
  });
});

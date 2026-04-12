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
    // The model has zeros but the live counts have 1 sanction + 1 escalation
    // + 1 breach. Impact must reflect live = 5+3+2 = 10, not 0.
    const markdown = buildIncidentReportMarkdown(makeModel(), 1, 1, 1, null);
    expect(markdown).toContain('**Impact:** 10');
    expect(markdown).toContain('**Sanctions:** 1');
    expect(markdown).toContain('**Escalations:** 1');
    expect(markdown).toContain('**Containment Breaches:** 1');
  });

  it('renders a heading, summary, and diagnosis line in order', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({
        legacyInfraClass: 'Phoenix IV',
        incidentFeedSummary: 'Core meltdown',
        diagnosis: 'Thermal overrun',
      }),
      0,
      0,
      0,
      null,
    );
    const heading = markdown.indexOf('# Phoenix IV');
    const summary = markdown.indexOf('Core meltdown');
    const diagnosis = markdown.indexOf('**Diagnosis:** Thermal overrun');
    expect(heading).toBeLessThan(summary);
    expect(summary).toBeLessThan(diagnosis);
  });

  it('renders the share quote as a blockquote when present', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ shareQuote: 'quote one' }),
      0,
      0,
      0,
      null,
    );
    expect(markdown).toContain('> quote one');
  });

  it('omits the share-quote blockquote when the quote is empty', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ shareQuote: '' }),
      0,
      0,
      0,
      null,
    );
    expect(markdown).not.toContain('> ');
  });

  it('includes the filed timestamp line when liveTimestamp is provided', () => {
    // Not asserting the exact formatted string — that belongs in
    // utils.formatTimestamp's own test. Just pin that the line exists
    // when (and only when) a timestamp is passed.
    const withTs = buildIncidentReportMarkdown(
      makeModel(),
      0,
      0,
      0,
      new Date('2026-04-10T00:00:00Z'),
    );
    expect(withTs).toMatch(/\*\*Filed:\*\* /);
    const noTs = buildIncidentReportMarkdown(makeModel(), 0, 0, 0, null);
    expect(noTs).not.toContain('**Filed:**');
  });

  it('renders the Telemetry section only when at least one telemetry field is non-empty', () => {
    const withAll = buildIncidentReportMarkdown(
      makeModel({
        failureOrigin: 'o',
        primaryContamination: 'p',
        contributingFactor: 'c',
      }),
      0,
      0,
      0,
      null,
    );
    expect(withAll).toContain('## Telemetry');
    expect(withAll).toContain('**Failure Origin:** o');
    expect(withAll).toContain('**Primary Contaminant:** p');
    expect(withAll).toContain('**Contributing Factor:** c');

    const noneSet = buildIncidentReportMarkdown(
      makeModel({ failureOrigin: '', primaryContamination: '', contributingFactor: '' }),
      0,
      0,
      0,
      null,
    );
    expect(noneSet).not.toContain('## Telemetry');
  });

  it('renders a partial Telemetry section when only one field is set', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ failureOrigin: 'o', primaryContamination: '', contributingFactor: '' }),
      0,
      0,
      0,
      null,
    );
    expect(markdown).toContain('## Telemetry');
    expect(markdown).toContain('**Failure Origin:** o');
    expect(markdown).not.toContain('**Primary Contaminant:**');
    expect(markdown).not.toContain('**Contributing Factor:**');
  });

  it('always includes Disposition and Archive Note sections', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ disposition: 'shipped', archiveNote: 'archived' }),
      0,
      0,
      0,
      null,
    );
    expect(markdown).toContain('## Disposition');
    expect(markdown).toContain('shipped');
    expect(markdown).toContain('## Archive Note');
    expect(markdown).toContain('archived');
  });

  it('renders the filed-by footer with anonHandle and chromaticProfile', () => {
    const markdown = buildIncidentReportMarkdown(
      makeModel({ anonHandle: 'ghost-42', chromaticProfile: 'amber-rust' }),
      0,
      0,
      0,
      null,
    );
    expect(markdown).toContain('*Filed by ghost-42 · Chromatic Profile: amber-rust*');
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

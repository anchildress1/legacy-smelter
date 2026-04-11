import React, { useEffect, useRef, useState, useId } from 'react';
import { SmeltAnalysis } from '../services/geminiService';
import { SmeltLog, computeImpact } from '../types';
import { formatTimestamp, getFiveDistinctColors, buildIncidentUrl } from '../lib/utils';
import { X, Check, Copy, Link2, ShieldCheck, Siren, ChevronDown, ChevronUp } from 'lucide-react';
import { SeverityBadge } from './SeverityBadge';
import { recordBreach } from '../services/breachService';
import { useEscalation } from '../hooks/useEscalation';
import { db, doc, onSnapshot } from '../firebase';

interface OverlayProps {
  analysis?: SmeltAnalysis | null;
  log?: SmeltLog | null;
  shareLinks?: { label: string; href: string }[];
  incidentId?: string | null;
  onClose: () => void;
}

interface NormalisedReport {
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

function buildMarkdown(
  report: NormalisedReport,
  liveBreachCount: number,
  liveEscalationCount: number,
  liveSanctionCount: number,
  liveTimestamp: Date | null
): string {
  const liveCounts = { sanction_count: liveSanctionCount, escalation_count: liveEscalationCount, breach_count: liveBreachCount };
  const impact = computeImpact(liveCounts);
  const lines: string[] = [
    `# ${report.legacyInfraClass}`,
    '',
    report.incidentFeedSummary,
    '',
    `**Diagnosis:** ${report.diagnosis}`,
  ];

  if (report.shareQuote) {
    lines.push('', `> ${report.shareQuote}`);
  }

  lines.push(
    '',
    `**Severity:** ${report.severity}`,
    `**Impact:** ${impact}`,
    `**Sanctions:** ${liveSanctionCount}`,
    `**Escalations:** ${liveEscalationCount}`,
    `**Containment Breaches:** ${liveBreachCount}`,
  );

  if (liveTimestamp) {
    lines.push(`**Filed:** ${formatTimestamp(liveTimestamp)}`);
  }

  const telemetry = [
    report.failureOrigin ? `**Failure Origin:** ${report.failureOrigin}` : null,
    report.primaryContamination ? `**Primary Contaminant:** ${report.primaryContamination}` : null,
    report.contributingFactor ? `**Contributing Factor:** ${report.contributingFactor}` : null,
  ].filter((s): s is string => s !== null);

  if (telemetry.length > 0) {
    lines.push('', '---', '', '## Telemetry', '', ...telemetry);
  }

  lines.push(
    '', '---', '',
    '## Disposition', '',
    report.disposition,
    '',
    '## Archive Note', '',
    report.archiveNote,
    '', '---', '',
    `*Filed by ${report.anonHandle} · Chromatic Profile: ${report.chromaticProfile}*`,
  );

  return lines.join('\n');
}

function normalise(a?: SmeltAnalysis | null, l?: SmeltLog | null): NormalisedReport | null {
  if (a) {
    return {
      legacyInfraClass: a.legacyInfraClass,
      incidentFeedSummary: a.incidentFeedSummary,
      severity: a.severity,
      diagnosis: a.diagnosis,
      failureOrigin: a.failureOrigin,
      primaryContamination: a.primaryContamination,
      contributingFactor: a.contributingFactor,
      disposition: a.disposition,
      archiveNote: a.archiveNote,
      shareQuote: a.shareQuote,
      anonHandle: a.anonHandle,
      chromaticProfile: a.chromaticProfile,
      dominantColors: a.dominantColors,
      sanctionCount: 0,
      breachCount: 0,
      escalationCount: 0,
      sanctioned: false,
      sanctionRationale: null,
      timestamp: null,
    };
  }
  if (l) {
    return {
      legacyInfraClass: l.legacy_infra_class,
      incidentFeedSummary: l.incident_feed_summary,
      severity: l.severity,
      diagnosis: l.diagnosis,
      failureOrigin: l.failure_origin,
      primaryContamination: l.primary_contamination,
      contributingFactor: l.contributing_factor,
      disposition: l.disposition,
      archiveNote: l.archive_note,
      shareQuote: l.share_quote,
      anonHandle: l.anon_handle,
      chromaticProfile: l.chromatic_profile,
      dominantColors: getFiveDistinctColors([l.color_1, l.color_2, l.color_3, l.color_4, l.color_5]),
      sanctionCount: l.sanction_count,
      breachCount: l.breach_count,
      escalationCount: l.escalation_count,
      sanctioned: l.sanctioned,
      sanctionRationale: l.sanction_rationale,
      timestamp: l.timestamp.toDate(),
    };
  }
  return null;
}

const SHARE_PLATFORMS: Record<string, { name: string; icon: React.ReactNode }> = {
  twitter: {
    name: 'X',
    icon: (
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  linkedin: {
    name: 'LINKEDIN',
    icon: (
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  bluesky: {
    name: 'BLUESKY',
    icon: (
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 01-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" />
      </svg>
    ),
  },
  reddit: {
    name: 'REDDIT',
    icon: (
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
      </svg>
    ),
  },
};

function assertOverlayInputs(
  analysis: SmeltAnalysis | null | undefined,
  log: SmeltLog | null | undefined,
  incidentId: string | null | undefined,
): void {
  if (!import.meta.env.DEV) return;
  if (analysis && log) {
    throw new Error('IncidentReportOverlay: pass `analysis` OR `log`, never both.');
  }
  if ((analysis || log) && !incidentId) {
    console.warn('IncidentReportOverlay: `incidentId` should be set when analysis or log is provided.');
  }
}

interface LiveCounts {
  sanction: number;
  breach: number;
  escalation: number;
  timestamp: Date | null;
}

type LiveCountsStaleReason = 'removed' | 'schema' | 'subscription' | null;

interface LiveCountsResult {
  readonly counts: LiveCounts;
  readonly staleReason: LiveCountsStaleReason;
}

function useLiveIncidentCounts(
  incidentId: string | null | undefined,
  seed: NormalisedReport | null,
): LiveCountsResult {
  const [counts, setCounts] = useState<LiveCounts>(() => ({
    sanction: seed?.sanctionCount ?? 0,
    breach: seed?.breachCount ?? 0,
    escalation: seed?.escalationCount ?? 0,
    timestamp: seed?.timestamp ?? null,
  }));
  const [staleReason, setStaleReason] = useState<LiveCountsStaleReason>(null);

  useEffect(() => {
    setCounts({
      sanction: seed?.sanctionCount ?? 0,
      breach: seed?.breachCount ?? 0,
      escalation: seed?.escalationCount ?? 0,
      timestamp: seed?.timestamp ?? null,
    });
    setStaleReason(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  useEffect(() => {
    if (!incidentId) return;
    return onSnapshot(doc(db, 'incident_logs', incidentId), (snap) => {
      if (!snap.exists()) {
        console.error(`[IncidentReportOverlay] incident_logs/${incidentId} removed from archive while overlay open.`);
        setStaleReason('removed');
        return;
      }
      const data = snap.data();
      const sc = data.sanction_count;
      const bc = data.breach_count;
      const ec = data.escalation_count;
      if (
        !Number.isFinite(sc) ||
        !Number.isFinite(bc) ||
        !Number.isFinite(ec) ||
        sc < 0 ||
        bc < 0 ||
        ec < 0
      ) {
        console.error(
          `[IncidentReportOverlay] incident_logs/${incidentId} has invalid counter fields`,
          { sanction_count: sc, breach_count: bc, escalation_count: ec }
        );
        setStaleReason('schema');
        return;
      }
      const ts = data.timestamp;
      const nextTimestamp = ts && typeof ts.toDate === 'function' ? ts.toDate() as Date : null;
      setCounts({ sanction: sc, breach: bc, escalation: ec, timestamp: nextTimestamp });
      setStaleReason(null);
    }, (error) => {
      console.error('[IncidentReportOverlay] Live count subscription failed:', error);
      setStaleReason('subscription');
    });
  }, [incidentId]);

  return { counts, staleReason };
}

function staleReasonCopy(reason: LiveCountsStaleReason): string | null {
  switch (reason) {
    case 'removed':
      return 'LIVE COUNTS STALE. INCIDENT REMOVED FROM ARCHIVE.';
    case 'schema':
      return 'LIVE COUNTS STALE. ARCHIVE SCHEMA DRIFT.';
    case 'subscription':
      return 'LIVE COUNTS STALE. SUBSCRIPTION ERRORED.';
    default:
      return null;
  }
}

function useModalDialog(onClose: () => void): React.RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);
  return dialogRef;
}

export const IncidentReportOverlay: React.FC<OverlayProps> = ({ analysis, log, shareLinks, incidentId, onClose }) => {
  assertOverlayInputs(analysis, log, incidentId);
  const report = normalise(analysis, log);
  const dialogRef = useModalDialog(onClose);
  const [copyTextState, setCopyTextState] = useState<'idle' | 'copied'>('idle');
  const [copyLinkState, setCopyLinkState] = useState<'idle' | 'copied'>('idle');
  const [breachError, setBreachError] = useState<Error | null>(null);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const { counts, staleReason } = useLiveIncidentCounts(incidentId, report);
  const staleMessage = staleReasonCopy(staleReason);
  const liveCountsForImpact = {
    sanction_count: counts.sanction,
    escalation_count: counts.escalation,
    breach_count: counts.breach,
  };
  const {
    escalated,
    isToggling: isTogglingEscalation,
    toggleError: escalationError,
    toggle: toggleEscalate,
  } = useEscalation(incidentId ?? null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyLinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breachEpochRef = useRef(0);
  const headingId = useId();

  const incidentUrl = incidentId ? buildIncidentUrl(incidentId) : null;

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) clearTimeout(copyTimeoutRef.current);
      if (copyLinkTimeoutRef.current !== null) clearTimeout(copyLinkTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    breachEpochRef.current += 1;
    setBreachError(null);
  }, [incidentId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) onClose();
    };
    dialog.addEventListener('click', handleBackdropClick);
    return () => dialog.removeEventListener('click', handleBackdropClick);
  }, [dialogRef, onClose]);

  if (!report) return null;

  const recordBreachAsync = () => {
    if (!incidentId) return;
    setBreachError(null);
    const requestEpoch = breachEpochRef.current;
    recordBreach(incidentId)
      .then((result) => {
        if (breachEpochRef.current !== requestEpoch) return;
        if (result.ok || result.skipped) return;
        console.error('[IncidentReportOverlay] Breach record failed:', result.error);
        setBreachError(new Error(result.error ?? 'Breach record failed'));
      })
      .catch((err) => {
        if (breachEpochRef.current !== requestEpoch) {
          console.warn('[IncidentReportOverlay] Ignoring stale breach failure for previous incident:', err);
          return;
        }
        console.error('[IncidentReportOverlay] Breach record threw unexpectedly:', err);
        setBreachError(err instanceof Error ? err : new Error(String(err)));
      });
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdown(report, counts.breach, counts.escalation, counts.sanction, counts.timestamp));
      setCopyTextState('copied');
      if (copyTimeoutRef.current !== null) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyTextState('idle'), 2000);
      recordBreachAsync();
    } catch (err) {
      console.error('[IncidentReportOverlay] Clipboard write failed:', err);
    }
  };

  const handleEscalate = () => {
    toggleEscalate().catch((err: unknown) => {
      console.error('[IncidentReportOverlay] toggleEscalate unexpectedly threw:', err);
    });
  };

  const handleCopyLink = async () => {
    if (!incidentUrl) return;
    try {
      await navigator.clipboard.writeText(incidentUrl);
      setCopyLinkState('copied');
      if (copyLinkTimeoutRef.current !== null) clearTimeout(copyLinkTimeoutRef.current);
      copyLinkTimeoutRef.current = setTimeout(() => setCopyLinkState('idle'), 2000);
      recordBreachAsync();
    } catch (err) {
      console.error('[IncidentReportOverlay] Clipboard write failed:', err);
    }
  };

  const platforms = (shareLinks ?? []).filter(l => SHARE_PLATFORMS[l.label]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      className="bg-transparent p-0 m-0 max-w-none max-h-none w-screen h-[100dvh] backdrop:bg-black/70 backdrop:backdrop-blur-[2px] open:flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        className="bg-[#1a1a1a] w-full sm:max-w-2xl sm:rounded-lg shadow-2xl h-[100dvh] sm:max-h-[90vh] overflow-hidden flex flex-row outline-none"
      >
        {/* Left chromatic strip. Inline filter avoids Tailwind v4
            CSS-variable composition issues with overflow-hidden + rounded
            contexts. Stronger cut (0.6/0.85) than the card strip because
            the modal is larger on screen and needs a deeper reduction
            to stay subordinate to the title hierarchy. */}
        <div
          className="flex w-2 shrink-0 flex-col sm:rounded-l-lg overflow-hidden"
          style={{ filter: 'saturate(0.6) brightness(0.85)' }}
          aria-hidden="true"
        >
          {report.dominantColors.map((color) => (
            <div key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>

        {/* Main content column */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* ── HEADER BAR ── */}
          <div className="shrink-0 flex items-center justify-between gap-2 pl-5 sm:pl-8 pr-2 py-2.5">
            <h2 id={headingId} className="text-stone-gray font-mono text-[11px] uppercase tracking-widest shrink-0">
              Postmortem
            </h2>
            <div className="flex items-center gap-1 shrink-0">
              {platforms.map(({ label, href }) => {
                const cfg = SHARE_PLATFORMS[label];
                return (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={recordBreachAsync}
                    className="w-6 h-6 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hazard-amber"
                    aria-label={`Post to ${cfg.name}`}
                    title={cfg.name}
                  >
                    {cfg.icon}
                  </a>
                );
              })}
              {incidentUrl && (
                <button
                  onClick={handleCopyLink}
                  className="w-6 h-6 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hazard-amber"
                  aria-label={copyLinkState === 'copied' ? 'Link copied' : 'Copy link'}
                  title={copyLinkState === 'copied' ? 'Copied!' : 'Copy link'}
                >
                  {copyLinkState === 'copied' ? <Check size={12} /> : <Link2 size={12} />}
                </button>
              )}
              <button
                onClick={handleCopyText}
                className="w-6 h-6 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hazard-amber"
                aria-label={copyTextState === 'copied' ? 'Brief copied' : 'Copy brief'}
                title={copyTextState === 'copied' ? 'Copied!' : 'Copy brief'}
              >
                {copyTextState === 'copied' ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <div className="w-px h-4 bg-concrete-border mx-0.5" aria-hidden="true" />
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hazard-amber"
                aria-label="Close report"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Hazard stripe */}
          <div className="hazard-stripe h-1 w-full shrink-0" />

          {/* ── SCROLLABLE BODY ── */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 sm:px-8 py-5 sm:py-6">

              {/* ═══ SECTION 1 — INCIDENT OVERVIEW ═══
                  Title + status cluster at the top, then summary,
                  quote (quieter), metrics. Tight internal spacing
                  makes these four read as one unit. */}
              <section aria-label="Incident overview" className="space-y-3">

                {/* Title row: title (left) + severity + escalate (right) */}
                <div>
                  <div className="flex justify-between items-start gap-3">
                    <h3 className="text-hazard-amber font-mono text-base sm:text-lg uppercase tracking-wide font-black leading-tight">
                      {report.legacyInfraClass}
                    </h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <SeverityBadge severity={report.severity} />
                      {incidentId && (
                        <>
                          <div className="w-px h-4 bg-concrete-border" aria-hidden="true" />
                          <button
                            onClick={handleEscalate}
                            disabled={isTogglingEscalation}
                            className={`inline-flex items-center gap-1 rounded border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber ${
                              escalated
                                ? 'border-hazard-amber/70 bg-hazard-amber/15 text-hazard-amber'
                                : 'border-[#777] text-ash-white/80 hover:text-hazard-amber hover:border-hazard-amber/70 hover:bg-hazard-amber/5'
                            } ${isTogglingEscalation ? 'opacity-50' : ''}`}
                            aria-label={escalated ? 'Remove escalation' : 'Escalate'}
                            aria-pressed={escalated}
                          >
                            <Siren size={10} aria-hidden="true" />
                            {escalated ? 'Armed' : 'Escalate'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Sanction badge — beneath title row */}
                  {counts.sanction > 0 && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono text-zinc-950 bg-hazard-amber/90 px-1.5 py-0.5 rounded uppercase font-bold">
                      <ShieldCheck size={9} aria-hidden="true" />
                      Sanctioned
                    </span>
                  )}

                  {/* Escalation / breach errors — inline under the action that produced them.
                      The raw error.message is rendered verbatim so a future refactor that wraps
                      the error (e.g. `new Error('Escalation failed')`) cannot silently strip the
                      real cause from the UI. The escalation alert is gated on `incidentId` to
                      match the escalate button's gating — the alert without the action that
                      produces it would be orphaned UI. */}
                  {escalationError && incidentId && (
                    <p role="alert" className="mt-1.5 text-[10px] font-mono normal-case tracking-normal text-hazard-amber">
                      Escalation failed: {escalationError.message}
                    </p>
                  )}
                  {breachError && (
                    <p
                      role="alert"
                      data-testid="breach-error"
                      className="mt-1 text-[10px] font-mono normal-case tracking-normal text-hazard-amber"
                    >
                      Breach record failed: {breachError.message}
                    </p>
                  )}
                </div>

                {/* Summary */}
                <p className="text-ash-white font-mono text-sm leading-relaxed">
                  {report.incidentFeedSummary}
                </p>

                {/* Quote — tertiary, reduced contrast so it doesn't
                    compete with the summary above it. */}
                <blockquote className="border-l-2 border-hazard-amber/60 pl-4">
                  <p className="text-hazard-amber/75 font-mono text-sm italic leading-snug">
                    "{report.shareQuote}"
                  </p>
                </blockquote>

                {/* Metrics — no box, just breathing room.
                    Stale indicator rendered inline below the row. */}
                <div
                  className="flex items-baseline justify-between pt-2"
                  data-testid="incident-stats-row"
                  data-live-stale={staleReason ?? 'fresh'}
                >
                  {[
                    { value: computeImpact(liveCountsForImpact), label: 'Impact' },
                    { value: counts.sanction, label: 'Sanctions' },
                    { value: counts.escalation, label: 'Escalations' },
                    { value: counts.breach, label: 'Breaches' },
                  ].map(({ value, label }) => (
                    <div key={label} className="text-center">
                      <div className="text-hazard-amber font-mono text-xl sm:text-2xl font-black leading-none">{value}</div>
                      <div className="mt-1 text-[9px] font-mono uppercase tracking-[0.15em] text-ash-white/60">{label}</div>
                    </div>
                  ))}
                </div>
                {staleMessage && (
                  <output
                    data-testid="incident-stale-indicator"
                    className="block text-[10px] font-mono uppercase tracking-wider text-hazard-amber"
                  >
                    {staleMessage}
                  </output>
                )}
              </section>

              {/* ═══ SECTION 2 — RECOMMENDED ACTION ═══
                  Tight coupling to overview — no divider, short gap. */}
              <section aria-label="Recommended action" className="mt-5">
                <h4 className="text-stone-gray font-mono text-[10px] uppercase tracking-[0.15em]">Recommended Action</h4>
                <p className="mt-1.5 text-ash-white font-mono text-sm leading-relaxed">{report.disposition}</p>
              </section>

              {/* ═══ SECTION 3 — DIAGNOSTICS ═══
                  Firm divider + larger gap signals a priority step-down. */}
              <section aria-label="Diagnostics" className="mt-8 border-t border-concrete-border pt-6">
                <h4 className="text-stone-gray font-mono text-[10px] uppercase tracking-[0.15em] mb-3">Diagnostics</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 font-mono">
                  <div>
                    <dt className="text-[9px] uppercase tracking-wider text-stone-gray">Primary Contaminant</dt>
                    <dd className="text-ash-white text-sm mt-0.5">{report.primaryContamination}</dd>
                  </div>
                  <div>
                    <dt className="text-[9px] uppercase tracking-wider text-stone-gray">Contributing Factor</dt>
                    <dd className="text-ash-white text-sm mt-0.5">{report.contributingFactor}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[9px] uppercase tracking-wider text-stone-gray">Diagnosis</dt>
                    <dd className="text-ash-white text-sm mt-0.5">{report.diagnosis}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[9px] uppercase tracking-wider text-stone-gray">Failure Origin</dt>
                    <dd className="text-ash-white text-sm mt-0.5">{report.failureOrigin}</dd>
                  </div>
                </dl>
              </section>

              {/* ═══ SECTION 4 — ARCHIVE ═══
                  Lowest priority. Archive note collapsed by default —
                  long postmortems are evidence, not primary reading. */}
              <section aria-label="Archive" className="mt-8 border-t border-concrete-border/50 pt-6 space-y-4">

                {/* Archive note — collapsible */}
                <div>
                  <button
                    type="button"
                    onClick={() => setArchiveExpanded(v => !v)}
                    className="flex items-center gap-2 text-stone-gray font-mono text-[10px] uppercase tracking-[0.15em] hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hazard-amber rounded"
                    aria-expanded={archiveExpanded}
                  >
                    <h4 className="pointer-events-none">Archive Note</h4>
                    {archiveExpanded
                      ? <ChevronUp size={11} aria-hidden="true" />
                      : <ChevronDown size={11} aria-hidden="true" />
                    }
                  </button>
                  {archiveExpanded && (
                    <p className="mt-1.5 text-ash-white font-mono text-sm leading-relaxed">
                      {report.archiveNote}
                    </p>
                  )}
                </div>

                {/* Sanction rationale */}
                {counts.sanction > 0 && report.sanctionRationale && (
                  <div className="border-t border-hazard-amber/20 pt-4">
                    <h4 className="text-hazard-amber font-mono text-[10px] uppercase tracking-[0.15em] flex items-center gap-1.5">
                      <ShieldCheck size={10} aria-hidden="true" />
                      Sanction Rationale
                    </h4>
                    <p className="mt-1.5 text-hazard-amber/80 font-mono text-sm leading-relaxed italic">{report.sanctionRationale}</p>
                  </div>
                )}

                {/* Case footer */}
                <div className="border-t border-concrete-border/40 pt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-xs text-stone-gray">
                  <span>Filed by <span className="text-hazard-amber font-bold">{report.anonHandle}</span></span>
                  {counts.timestamp && <span>{formatTimestamp(counts.timestamp)}</span>}
                  <span>{report.chromaticProfile}</span>
                </div>
              </section>

            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
};

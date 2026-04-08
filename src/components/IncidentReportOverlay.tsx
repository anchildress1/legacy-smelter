import React, { useEffect, useRef, useState, useId } from 'react';
import { SmeltAnalysis } from '../services/geminiService';
import { SmeltLog, Severity, computeImpact, withVotingDefaults } from '../types';
import { formatTimestamp, getFiveDistinctColors, buildIncidentUrl } from '../lib/utils';
import { X, AlertTriangle, Check, Copy, Link2, ShieldCheck, Siren } from 'lucide-react';
import { recordBreach } from '../services/breachService';
import { toggleEscalation, hasEscalated, syncEscalationState } from '../services/escalationService';
import { db, doc, onSnapshot } from '../firebase';

// analysis and log are mutually exclusive — exactly one should be non-null per call site
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
  severity: Severity;
  failureOrigin: string;
  primaryContamination: string;
  contributingFactor: string;
  systemDx: string;
  disposition: string;
  archiveNote: string;
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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
}

function buildMarkdown(
  report: NormalisedReport,
  liveBreachCount: number,
  liveEscalationCount: number,
  liveSanctionCount: number
): string {
  const impact = computeImpact(liveSanctionCount, liveEscalationCount, liveBreachCount);
  const lines: string[] = [
    `# ${report.legacyInfraClass}`,
    '',
    report.incidentFeedSummary,
    '',
    `**Severity:** ${report.severity}`,
    `**Impact:** ${impact}`,
    `**Sanctions:** ${liveSanctionCount}`,
    `**Escalations:** ${liveEscalationCount}`,
    `**Containment Breaches:** ${liveBreachCount}`,
  ];

  if (report.timestamp) {
    lines.push(`**Filed:** ${formatTimestamp(report.timestamp)}`);
  }

  const telemetry = [
    report.failureOrigin ? `**Failure Origin:** ${report.failureOrigin}` : null,
    report.systemDx ? `**System Diagnosis:** ${report.systemDx}` : null,
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
      failureOrigin: a.failureOrigin,
      primaryContamination: a.primaryContamination,
      contributingFactor: a.contributingFactor,
      systemDx: a.systemDx,
      disposition: a.disposition,
      archiveNote: a.archiveNote,
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
    const n = withVotingDefaults(l);
    return {
      legacyInfraClass: n.legacy_infra_class,
      incidentFeedSummary: n.incident_feed_summary,
      severity: n.severity,
      failureOrigin: n.failure_origin,
      primaryContamination: n.primary_contamination,
      contributingFactor: n.contributing_factor,
      systemDx: n.system_dx,
      disposition: n.disposition,
      archiveNote: n.archive_note,
      anonHandle: n.anon_handle,
      chromaticProfile: n.chromatic_profile,
      dominantColors: getFiveDistinctColors([n.color_1, n.color_2, n.color_3, n.color_4, n.color_5]),
      sanctionCount: n.sanction_count,
      breachCount: n.breach_count,
      escalationCount: n.escalation_count,
      sanctioned: n.sanctioned,
      sanctionRationale: n.sanction_rationale ?? null,
      timestamp: n.timestamp?.toDate?.() ?? null,
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

export const IncidentReportOverlay: React.FC<OverlayProps> = ({ analysis, log, shareLinks, incidentId, onClose }) => {
  const report = normalise(analysis, log);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const [copyTextState, setCopyTextState] = useState<'idle' | 'copied'>('idle');
  const [copyLinkState, setCopyLinkState] = useState<'idle' | 'copied'>('idle');
  const [liveSanctionCount, setLiveSanctionCount] = useState<number>(report?.sanctionCount ?? 0);
  const [liveBreachCount, setLiveBreachCount] = useState<number>(report?.breachCount ?? 0);
  const [liveEscalationCount, setLiveEscalationCount] = useState<number>(report?.escalationCount ?? 0);
  const [escalated, setEscalated] = useState<boolean>(() => incidentId ? hasEscalated(incidentId) : false);
  const [isTogglingEscalation, setIsTogglingEscalation] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyLinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingId = useId();

  // Sync escalation state with Firestore on mount
  useEffect(() => {
    if (!incidentId) return;
    let cancelled = false;
    syncEscalationState(incidentId)
      .then((state) => { if (!cancelled) setEscalated(state); })
      .catch((err) => { console.error('[IncidentReportOverlay] syncEscalationState failed:', err); });
    return () => { cancelled = true; };
  }, [incidentId]);

  // Live-subscribe to counter fields while overlay is open
  useEffect(() => {
    if (!incidentId) return;
    return onSnapshot(doc(db, 'incident_logs', incidentId), (snap) => {
      if (snap.exists()) {
        const live = withVotingDefaults({ id: snap.id, ...snap.data() } as SmeltLog);
        setLiveSanctionCount(live.sanction_count);
        setLiveBreachCount(live.breach_count);
        setLiveEscalationCount(live.escalation_count);
      }
    }, (error) => {
      console.error('[IncidentReportOverlay] Live count subscription failed:', error);
    });
  }, [incidentId]);

  // Derive incident URL from incidentId — used for the copy-link button
  const incidentUrl = incidentId ? buildIncidentUrl(incidentId) : null;

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) clearTimeout(copyTimeoutRef.current);
      if (copyLinkTimeoutRef.current !== null) clearTimeout(copyLinkTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    lastActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusables = getFocusableElements(panelRef.current);
      if (focusables.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const isInsidePanel = activeEl ? panelRef.current.contains(activeEl) : false;

      if (e.shiftKey) {
        if (!isInsidePanel || activeEl === first) {
          e.preventDefault();
          last.focus();
        }
        return;
      }

      if (!isInsidePanel || activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      lastActiveElementRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (!report) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdown(report, liveBreachCount, liveEscalationCount, liveSanctionCount));
      handleBreach();
      setCopyTextState('copied');
      if (copyTimeoutRef.current !== null) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyTextState('idle'), 2000);
    } catch (err) {
      console.error('[IncidentReportOverlay] Clipboard write failed:', err);
    }
  };

  // Fire-and-forget: breach recording is best-effort analytics.
  // recordBreach handles its own errors internally.
  const handleBreach = () => {
    if (incidentId) void recordBreach(incidentId);
  };

  const handleEscalate = async () => {
    if (!incidentId || isTogglingEscalation) return;
    setIsTogglingEscalation(true);
    try {
      const wasEscalated = escalated;
      setEscalated(!wasEscalated);
      const newState = await toggleEscalation(incidentId);
      if (newState === wasEscalated) setEscalated(wasEscalated);
    } catch (err) {
      console.error('[IncidentReportOverlay] Escalation failed:', err);
    } finally {
      setIsTogglingEscalation(false);
    }
  };

  const handleCopyLink = async () => {
    if (!incidentUrl) return;
    try {
      await navigator.clipboard.writeText(incidentUrl);
      handleBreach();
      setCopyLinkState('copied');
      if (copyLinkTimeoutRef.current !== null) clearTimeout(copyLinkTimeoutRef.current);
      copyLinkTimeoutRef.current = setTimeout(() => setCopyLinkState('idle'), 2000);
    } catch (err) {
      console.error('[IncidentReportOverlay] Clipboard write failed:', err);
    }
  };

  const platforms = (shareLinks || []).filter(l => SHARE_PLATFORMS[l.label]);

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
    >
      {/* Card — full-screen on mobile, constrained modal on desktop */}
      <div
        ref={panelRef}
        className="bg-concrete-light w-full sm:max-w-3xl lg:max-w-4xl sm:rounded-xl border-t sm:border border-concrete-border shadow-2xl max-h-[100dvh] sm:max-h-[85vh] overflow-y-auto sm:overflow-hidden sm:flex outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        {/* Color palette strip — left on desktop, top on mobile */}
        <div className="hidden sm:flex w-2 shrink-0 flex-col rounded-l-xl overflow-hidden" aria-hidden="true">
          {report.dominantColors.map((color, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex sm:hidden h-1.5 w-full shrink-0" aria-hidden="true">
          {report.dominantColors.map((color, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>

        {/* Content — fixed header zone + scrollable details on desktop */}
        <div className="sm:flex-1 sm:min-w-0 sm:flex sm:flex-col sm:overflow-hidden">
          {/* Hazard stripe */}
          <div className="hazard-stripe h-1.5 w-full shrink-0" />

          {/* ── TOP ACTION BAR: label + share icons + close ── */}
          <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-concrete-border">
            <h2 id={headingId} className="text-hazard-amber font-mono text-xs uppercase tracking-widest">
              INCIDENT POSTMORTEM
            </h2>
            <div className="flex items-center gap-1.5">
              {platforms.map(({ label, href }) => {
                const cfg = SHARE_PLATFORMS[label];
                return (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleBreach}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-concrete-mid border border-concrete-border text-stone-gray hover:text-ash-white active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber"
                    aria-label={`Post to ${cfg.name}`}
                    title={`Post to ${cfg.name}`}
                  >
                    {cfg.icon}
                  </a>
                );
              })}
              {incidentUrl && (
                <button
                  onClick={handleCopyLink}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-concrete-mid border border-concrete-border text-stone-gray hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber active:scale-95"
                  aria-label={copyLinkState === 'copied' ? 'Link copied' : 'Copy link'}
                  title={copyLinkState === 'copied' ? 'Link copied' : 'Copy link'}
                >
                  {copyLinkState === 'copied'
                    ? <Check size={12} aria-hidden="true" />
                    : <Link2 size={12} aria-hidden="true" />}
                </button>
              )}
              <button
                onClick={handleCopyText}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-concrete-mid border border-concrete-border text-stone-gray hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber active:scale-95"
                aria-label={copyTextState === 'copied' ? 'Text copied' : 'Copy text'}
                title={copyTextState === 'copied' ? 'Text copied' : 'Copy text'}
              >
                {copyTextState === 'copied'
                  ? <Check size={12} aria-hidden="true" />
                  : <Copy size={12} aria-hidden="true" />}
              </button>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-concrete-mid/80 text-stone-gray hover:text-ash-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber"
                aria-label="Close report"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* ── NON-SCROLLING HEADER ZONE ── */}
          <div className="shrink-0 p-5 sm:p-6">
            <p className="text-hazard-amber font-mono text-base sm:text-lg uppercase tracking-wide font-bold leading-tight">
              {report.legacyInfraClass}
            </p>
            <p className="text-ash-white font-mono text-sm sm:text-base leading-snug mt-1.5">
              {report.incidentFeedSummary}
            </p>
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              {liveSanctionCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-950 bg-hazard-amber px-2.5 py-1 rounded uppercase font-bold">
                  <ShieldCheck size={11} aria-hidden="true" />
                  SANCTIONED
                </span>
              )}
              <span
                className="inline-flex items-center gap-1.5 text-xs font-mono text-concrete-light bg-hazard-amber px-2.5 py-1 rounded uppercase font-bold"
              >
                <AlertTriangle size={10} aria-hidden="true" />
                {report.severity}
              </span>
              {report.timestamp && (
                <span className="text-stone-gray font-mono text-[10px] uppercase tracking-widest ml-auto">
                  {formatTimestamp(report.timestamp)}
                </span>
              )}
            </div>
            {/* Scores: ordered by point weight (impact, sanctions, escalations, breaches) */}
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-concrete-border">
              <div className="text-center">
                <div className="text-hazard-amber font-mono text-lg font-black leading-none">
                  {computeImpact(liveSanctionCount, liveEscalationCount, liveBreachCount)}
                </div>
                <div className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mt-0.5">IMPACT</div>
              </div>
              <div className="w-px h-8 bg-concrete-border" />
              <div className="text-center">
                <div className="text-hazard-amber font-mono text-lg font-black leading-none">{liveSanctionCount}</div>
                <div className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mt-0.5">SANCTIONS</div>
              </div>
              <div className="w-px h-8 bg-concrete-border" />
              <div className="text-center">
                <div className="text-hazard-amber font-mono text-lg font-black leading-none">{liveEscalationCount}</div>
                <div className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mt-0.5">ESCALATIONS</div>
              </div>
              <div className="w-px h-8 bg-concrete-border" />
              <div className="text-center">
                <div className="text-hazard-amber font-mono text-lg font-black leading-none">{liveBreachCount}</div>
                <div className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mt-0.5">BREACHES</div>
              </div>
              {incidentId && (
                <>
                  <div className="w-px h-8 bg-concrete-border ml-auto" />
                  <button
                    onClick={handleEscalate}
                    disabled={isTogglingEscalation}
                    className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber ${
                      escalated
                        ? 'text-hazard-amber bg-hazard-amber/15'
                        : 'text-dead-gray hover:text-stone-gray hover:bg-concrete-mid/50'
                    } ${isTogglingEscalation ? 'opacity-50' : ''}`}
                    aria-label={escalated ? 'Remove escalation' : 'Escalate'}
                    title={escalated ? 'De-escalate' : 'Escalate'}
                  >
                    <Siren size={20} />
                    <span className="text-stone-gray font-mono text-[9px] uppercase tracking-widest">ESCALATE</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── SCROLLABLE TELEMETRY ZONE ── */}
          <div className="sm:flex-1 sm:overflow-y-auto border-t border-concrete-border px-5 sm:px-6 pb-6 space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset" tabIndex={0} role="region" aria-label="Incident details">

            {/* Telemetry fields */}
            {(report.failureOrigin || report.primaryContamination || report.contributingFactor || report.systemDx) && (
              <div className="pt-4">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 font-mono">
                  {report.failureOrigin && (
                    <div>
                      <dt className="text-stone-gray uppercase text-xs tracking-widest">FAILURE ORIGIN</dt>
                      <dd className="text-ash-white text-sm mt-0.5">{report.failureOrigin}</dd>
                    </div>
                  )}
                  {report.systemDx && (
                    <div>
                      <dt className="text-stone-gray uppercase text-xs tracking-widest">SYSTEM DIAGNOSIS</dt>
                      <dd className="text-ash-white text-sm mt-0.5">{report.systemDx}</dd>
                    </div>
                  )}
                  {report.primaryContamination && (
                    <div>
                      <dt className="text-stone-gray uppercase text-xs tracking-widest">PRIMARY CONTAMINANT</dt>
                      <dd className="text-ash-white text-sm mt-0.5">{report.primaryContamination}</dd>
                    </div>
                  )}
                  {report.contributingFactor && (
                    <div>
                      <dt className="text-stone-gray uppercase text-xs tracking-widest">CONTRIBUTING FACTOR</dt>
                      <dd className="text-ash-white text-sm mt-0.5">{report.contributingFactor}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* Disposition */}
            <div className="border-t border-concrete-border pt-4">
              <h3 className="text-stone-gray font-mono text-xs uppercase tracking-widest mb-1.5">DISPOSITION</h3>
              <p className="text-ash-white font-mono text-sm">{report.disposition}</p>
            </div>

            {/* Archive Note */}
            <div className="border-t border-concrete-border pt-4">
              <h3 className="text-stone-gray font-mono text-xs uppercase tracking-widest mb-1.5">ARCHIVE NOTE</h3>
              <p className="text-ash-white font-mono text-sm leading-relaxed">{report.archiveNote}</p>
            </div>

            {/* Sanction rationale */}
            {liveSanctionCount > 0 && report.sanctionRationale && (
              <div className="border-t border-concrete-border pt-4">
                <h3 className="text-stone-gray font-mono text-xs uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <ShieldCheck size={11} className="text-hazard-amber" aria-hidden="true" />
                  SANCTIONED — RATIONALE
                </h3>
                <p className="text-hazard-amber/90 font-mono text-sm leading-relaxed italic">
                  {report.sanctionRationale}
                </p>
              </div>
            )}

            {/* Filed by + Chromatic Profile */}
            <div className="border-t border-concrete-border pt-4 flex justify-between items-start">
              <div>
                <span className="text-stone-gray font-mono text-[10px] uppercase tracking-widest">INCIDENT FILED BY</span>
                <p className="text-hazard-amber font-mono text-sm font-bold mt-0.5">{report.anonHandle}</p>
              </div>
              <div className="text-right">
                <span className="text-stone-gray font-mono text-[10px] uppercase tracking-widest">CHROMATIC PROFILE</span>
                <p className="text-stone-gray font-mono text-xs mt-0.5">{report.chromaticProfile}</p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

import { useEffect, useRef, useState, useId, type FC, type ReactNode } from 'react';
import { SmeltAnalysis } from '../services/geminiService';
import { computeImpact, SmeltLog } from '../types';
import { formatTimestamp, buildIncidentUrl } from '../lib/utils';
import { X, Check, Copy, Link2, ShieldCheck, Siren } from 'lucide-react';
import { StatItem } from './StatItem';
import { SanctionBadge } from './SanctionBadge';
import { SeverityBadge } from './SeverityBadge';
import { P0Badge } from './P0Badge';
import { HEADER_PILL_BASE } from './HeaderPill';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
  IMPACT_GLOW_FILTER_ESCALATED_BUTTON,
} from '../lib/impactGlow';
import { recordBreach } from '../services/breachService';
import { useEscalation } from '../hooks/useEscalation';
import {
  useLiveIncidentCounts,
  staleReasonCopy,
} from '../hooks/useLiveIncidentCounts';
import { useModalDialog } from '../hooks/useModalDialog';
import {
  buildIncidentReportMarkdown,
  normalizeIncidentReport,
} from '../lib/incidentReportModel';

interface OverlayProps {
  analysis?: SmeltAnalysis | null;
  log?: SmeltLog | null;
  shareLinks?: { label: string; href: string }[];
  incidentId?: string | null;
  onClose: () => void;
  // Mirror of the front card's P0 treatment: when the incident is one
  // of the top-3 entries from `useRecentIncidentLogs`, render the same
  // static "P0" badge in the overlay header. The overlay doesn't
  // derive membership itself — callers (home queue, manifest, deep
  // link fetch) already know the top-3 set and pass this flag so the
  // badge stays in sync across surfaces without a second live
  // subscription.
  showP0Badge?: boolean;
}

const SHARE_PLATFORMS: Record<string, { name: string; icon: ReactNode }> = {
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

export const IncidentReportOverlay: FC<OverlayProps> = ({ analysis, log, shareLinks, incidentId, onClose, showP0Badge = false }) => {
  assertOverlayInputs(analysis, log, incidentId);
  const report = normalizeIncidentReport(analysis, log);
  const dialogRef = useModalDialog(onClose);
  const [copyTextState, setCopyTextState] = useState<'idle' | 'copied'>('idle');
  const [copyLinkState, setCopyLinkState] = useState<'idle' | 'copied'>('idle');
  const [breachError, setBreachError] = useState<Error | null>(null);
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
      await navigator.clipboard.writeText(
        buildIncidentReportMarkdown(
          report,
          counts.breach,
          counts.escalation,
          counts.sanction,
          counts.timestamp,
        ),
      );
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
        className="bg-concrete w-full sm:max-w-2xl sm:rounded-lg shadow-2xl h-[100dvh] sm:max-h-[90vh] overflow-hidden flex flex-row outline-none"
      >
        {/* Left chromatic strip. Inline filter — Tailwind v4 silently
            swallows class-based filter utilities when composed with
            overflow-hidden + rounded on the same element, so classes
            will not work here. `brightness(0.9)` is a feather-light
            dim that keeps hues vibrant and true (no saturation drop,
            no gray cast) while just knocking the blinding edge off. */}
        <div
          className="flex w-2 shrink-0 flex-col sm:rounded-l-lg overflow-hidden"
          style={{ filter: 'brightness(0.9)' }}
          aria-hidden="true"
        >
          {report.dominantColors.map((color) => (
            <div key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>

        {/* Main content column */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* ── HEADER BAR ──
              Label pinned left, action icons pinned right. */}
          <div className="shrink-0 flex items-center justify-between gap-3 pl-4 pr-2 py-2.5">
            <h2 id={headingId} className="text-stone-gray font-mono text-[11px] uppercase tracking-widest shrink-0">
              Postmortem
            </h2>
            <div className="flex items-center min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-1 overflow-hidden min-w-0">
                {platforms.map(({ label, href }) => {
                  const cfg = SHARE_PLATFORMS[label];
                  return (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={recordBreachAsync}
                      className="w-8 h-8 sm:w-6 sm:h-6 shrink-0 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-ring-tight"
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
                    className="w-8 h-8 sm:w-6 sm:h-6 shrink-0 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-ring-tight"
                    aria-label={copyLinkState === 'copied' ? 'Link copied' : 'Copy link'}
                    title={copyLinkState === 'copied' ? 'Copied!' : 'Copy link'}
                  >
                    {copyLinkState === 'copied' ? <Check size={12} /> : <Link2 size={12} />}
                  </button>
                )}
                <button
                  onClick={handleCopyText}
                  className="w-8 h-8 sm:w-6 sm:h-6 shrink-0 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-ring-tight"
                  aria-label={copyTextState === 'copied' ? 'Brief copied' : 'Copy brief'}
                  title={copyTextState === 'copied' ? 'Copied!' : 'Copy brief'}
                >
                  {copyTextState === 'copied' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-1 shrink-0 ml-1">
                <div className="w-px h-5 sm:h-4 bg-concrete-border" aria-hidden="true" />
                <button
                  onClick={onClose}
                  className="w-8 h-8 sm:w-6 sm:h-6 flex items-center justify-center rounded text-stone-gray hover:text-ash-white transition-colors focus-ring-tight"
                  aria-label="Close report"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Hazard stripe */}
          <div className="hazard-stripe h-1 w-full shrink-0" aria-hidden="true" />

          {/* ── SCROLLABLE BODY ── */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 sm:px-8 py-5 sm:py-6">

              {/* ═══ SECTION 1 — INCIDENT OVERVIEW ═══
                  Title + status cluster at the top, then summary,
                  quote (quieter), metrics. Relaxed internal spacing
                  (`space-y-6`) gives the quote in particular room to
                  breathe between the summary above and the metrics
                  band below, so the quieter tertiary emphasis does
                  not feel crammed. */}
              <section aria-label="Incident overview" className="space-y-6">

                {/* Title + badge cluster. On mobile, badges wrap below
                    the title instead of fighting for horizontal space. */}
                <div>
                  <h3 className="text-hazard-amber font-mono text-base sm:text-lg uppercase tracking-wide font-black leading-tight">
                    {report.legacyInfraClass}
                  </h3>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <SeverityBadge severity={report.severity} />
                    {showP0Badge && <P0Badge />}
                    {counts.sanction > 0 && <SanctionBadge />}
                    {incidentId && (
                      <>
                        <div className="w-px h-4 bg-concrete-border" aria-hidden="true" />
                        <button
                          onClick={handleEscalate}
                          disabled={isTogglingEscalation}
                          className={`${HEADER_PILL_BASE} transition-all focus-ring ${
                            escalated
                              ? `border-hazard-amber/70 bg-hazard-amber/15 text-hazard-amber ${IMPACT_GLOW_FILTER_ESCALATED_BUTTON}`
                              : 'border-stone-gray text-ash-white/80 hover:text-hazard-amber hover:border-hazard-amber/70 hover:bg-hazard-amber/5'
                          } ${isTogglingEscalation ? 'opacity-50' : ''}`}
                          aria-label={escalated ? 'Remove escalation' : 'Escalate'}
                          aria-pressed={escalated}
                        >
                          <Siren size={10} aria-hidden="true" />
                          {escalated ? 'Triggered' : 'Escalate'}
                        </button>
                      </>
                    )}
                  </div>

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
                    compete with the summary above it. Internal `py-1`
                    adds a touch of vertical breathing inside the
                    border frame so the italicized pull-quote feels
                    distinct from the surrounding text blocks. */}
                <blockquote className="border-l-2 border-hazard-amber/75 pl-4 py-1">
                  <p className="text-hazard-amber/90 font-mono text-sm italic leading-snug">
                    "{report.shareQuote}"
                  </p>
                </blockquote>

                {/* Metrics — Impact is the derived score so it lives in
                    its own fixed-width slot on the left (roughly one
                    third of the row), separated from the three raw
                    counters by a vertical divider. The fixed width
                    pushes the divider off-center to the right and
                    gives Impact room for its number + label to sit
                    centered inside the slot with breathing space on
                    both sides of the glow.

                    The Impact number carries a subtle static warm
                    drop-shadow glow to tie it visually to the hazard-
                    amber palette and signal that it is the lead metric.
                    When `escalated` is true, the glow intensifies and
                    the number's contrast steps up a notch — a quiet
                    visual echo of the TRIGGERED escalate button above. */}
                <div
                  className="flex items-stretch py-4 border-t border-b border-concrete-border"
                  data-testid="incident-stats-row"
                  data-live-stale={staleReason ?? 'fresh'}
                >
                  <div className="basis-1/3 flex flex-col items-center justify-center">
                    <div
                      className={`font-mono text-2xl sm:text-3xl font-black leading-none transition-all ${
                        escalated ? IMPACT_GLOW_ESCALATED : IMPACT_GLOW_BASE
                      }`}
                    >
                      {computeImpact(liveCountsForImpact)}
                    </div>
                    <div className="mt-1.5 text-[10px] font-mono uppercase tracking-[0.18em] font-bold text-hazard-amber">
                      Impact
                    </div>
                  </div>
                  <div className="w-px self-stretch bg-concrete-border" aria-hidden="true" />
                  <div className="flex flex-1 items-center justify-around">
                    {[
                      { value: counts.sanction, label: 'Sanctions' },
                      { value: counts.escalation, label: 'Escalations' },
                      { value: counts.breach, label: 'Breaches' },
                    ].map(({ value, label }) => (
                      <StatItem key={label} value={value} label={label} variant="stacked" />
                    ))}
                  </div>
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

              {/* ═══ SANCTION CALLOUT ═══
                  Visually distinct from the diagnostic/archive sections.
                  Sanctions are an achievement — the one incident out of
                  five that Gemini picked as the funniest. The callout
                  uses molten-orange branding to match the SanctionBadge
                  and stands apart from the neutral gray layout. */}
              {counts.sanction > 0 && report.sanctionRationale && (
                <div className="mt-8 rounded-lg border border-molten-orange/30 bg-molten-orange/5 px-5 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck size={14} className="text-molten-orange" aria-hidden="true" />
                    <h4 className="text-molten-orange font-mono text-[10px] uppercase tracking-widest font-bold">
                      Sanctioned
                    </h4>
                  </div>
                  <p className="text-ash-white font-mono text-sm italic leading-relaxed">
                    {report.sanctionRationale}
                  </p>
                </div>
              )}

              {/* ═══ SECTION 4 — ARCHIVE ═══
                  Lowest priority. Always rendered in full. */}
              <section aria-label="Archive" className="mt-8 border-t border-concrete-border/50 pt-6 space-y-4">

                {/* Archive note */}
                <div>
                  <h4 className="text-stone-gray font-mono text-[10px] uppercase tracking-[0.15em]">
                    Archive Note
                  </h4>
                  <p className="mt-1.5 text-ash-white font-mono text-sm leading-relaxed">
                    {report.archiveNote}
                  </p>
                </div>

                {/* Case footer */}
                <div className="border-t border-concrete-border/40 pt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-xs text-stone-gray">
                  <span>Filed by <span className="text-hazard-amber font-bold">{report.anonHandle}</span></span>
                  {counts.timestamp && <span>{formatTimestamp(counts.timestamp)}</span>}
                  <span>Chromatic profile: {report.chromaticProfile}</span>
                </div>
              </section>

            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
};

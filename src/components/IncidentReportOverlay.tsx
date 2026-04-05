import React, { useEffect, useRef, useState, useId } from 'react';
import { SmeltAnalysis } from '../services/geminiService';
import { SmeltLog } from '../types';
import { formatPixels } from '../lib/utils';
import { X, AlertTriangle, Check, Copy } from 'lucide-react';

/**
 * Accepts either a SmeltAnalysis (from the current session)
 * or a SmeltLog (from Firestore history). Normalises internally.
 */
interface OverlayProps {
  analysis?: SmeltAnalysis | null;
  log?: SmeltLog | null;
  shareLinks?: { label: string; href: string }[];
  onClose: () => void;
}

// Normalised shape used inside the component
interface NormalisedReport {
  legacyInfraClass: string;
  damageReport: string;
  smeltRating: string;
  rootCause: string;
  dominantContamination: string;
  secondaryContamination: string;
  cursedDx: string;
  salvageability: string;
  museumCaption: string;
  anonHandle: string;
  paletteName: string;
  dominantColors: string[];
  pixelCount: number;
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

function normalise(a?: SmeltAnalysis | null, l?: SmeltLog | null): NormalisedReport | null {
  if (a) {
    return {
      legacyInfraClass: a.legacyInfraClass,
      damageReport: a.damageReport,
      smeltRating: a.smeltRating,
      rootCause: a.rootCause,
      dominantContamination: a.dominantContamination,
      secondaryContamination: a.secondaryContamination,
      cursedDx: a.cursedDx,
      salvageability: a.salvageability,
      museumCaption: a.museumCaption,
      anonHandle: a.anonHandle,
      paletteName: a.paletteName,
      dominantColors: a.dominantColors,
      pixelCount: a.pixelCount,
    };
  }
  if (l) {
    return {
      legacyInfraClass: l.legacy_infra_class,
      damageReport: l.damage_report,
      smeltRating: l.smelt_rating,
      rootCause: l.root_cause,
      dominantContamination: l.dominant_contamination,
      secondaryContamination: l.secondary_contamination,
      cursedDx: l.cursed_dx,
      salvageability: l.salvageability,
      museumCaption: l.museum_caption,
      anonHandle: l.anon_handle,
      paletteName: l.palette_name,
      dominantColors: [l.color_1, l.color_2, l.color_3, l.color_4, l.color_5].filter(Boolean),
      pixelCount: l.pixel_count,
    };
  }
  return null;
}

export const IncidentReportOverlay: React.FC<OverlayProps> = ({ analysis, log, shareLinks, onClose }) => {
  const report = normalise(analysis, log);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const headingId = useId();

  // Trap focus inside modal and restore focus on close.
  useEffect(() => {
    lastActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

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

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (!report) return null;

  const formatted = formatPixels(report.pixelCount);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${report.damageReport}\n\n${report.museumCaption}`);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
    >
      {/* Card — full-screen on mobile, constrained modal on desktop */}
      <div
        ref={panelRef}
        className="bg-concrete-light w-full sm:max-w-3xl lg:max-w-4xl sm:rounded-xl border-t sm:border border-concrete-border shadow-2xl max-h-[100dvh] sm:max-h-[85vh] overflow-y-auto sm:overflow-hidden sm:flex relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        {/* Color palette strip — top edge on mobile, left edge on desktop */}
        <div className="hidden sm:flex w-2 shrink-0 flex-col rounded-l-xl overflow-hidden" aria-hidden="true">
          {report.dominantColors.map((color, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex sm:hidden h-1.5 w-full" aria-hidden="true">
          {report.dominantColors.map((color, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>

        <div className="sm:flex-1 sm:min-w-0 sm:overflow-y-auto">
          {/* Hazard stripe */}
          <div className="hazard-stripe h-1.5 w-full" />

          {/* Close button */}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="absolute top-3 right-3 sm:top-4 sm:right-4 w-8 h-8 flex items-center justify-center rounded-full bg-concrete-mid/80 text-stone-gray hover:text-ash-white transition-colors z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber"
            aria-label="Close report"
          >
            <X size={16} />
          </button>

          <div className="p-6 sm:p-8 space-y-5">
            {/* Header */}
            <div className="pr-8">
              <h2 id={headingId} className="text-hazard-amber font-mono text-sm uppercase tracking-widest">
                INCIDENT POSTMORTEM // DECOMMISSION REPORT
              </h2>
              <p className="text-hazard-amber font-mono text-lg sm:text-xl uppercase tracking-widest mt-2 font-bold">
                {report.legacyInfraClass}
              </p>
              <p className="text-ash-white font-mono text-base sm:text-lg leading-snug mt-2">
                {report.damageReport}
              </p>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-concrete-light bg-hazard-amber px-2.5 py-1 rounded uppercase font-bold"
                  aria-label={`Severity classification: ${report.smeltRating}`}
                >
                  <AlertTriangle size={10} aria-hidden="true" />
                  {report.smeltRating}
                </span>
                <span className="text-hazard-amber font-mono text-xs font-bold">
                  {formatted.value} {formatted.unit} THERMALLY DECOMMISSIONED
                </span>
              </div>
            </div>

            {/* Telemetry fields */}
            {(report.rootCause || report.dominantContamination || report.secondaryContamination || report.cursedDx) && (
            <div className="border-t border-concrete-border pt-4">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 font-mono">
                {report.rootCause && (
                <div>
                  <dt className="text-stone-gray uppercase text-sm tracking-widest">FAILURE ORIGIN ANALYSIS</dt>
                  <dd className="text-ash-white text-sm mt-0.5">{report.rootCause}</dd>
                </div>
                )}
                {report.cursedDx && (
                <div>
                  <dt className="text-stone-gray uppercase text-sm tracking-widest">CURSED DIAGNOSIS</dt>
                  <dd className="text-ash-white text-sm mt-0.5">{report.cursedDx}</dd>
                </div>
                )}
                {report.dominantContamination && (
                <div>
                  <dt className="text-stone-gray uppercase text-sm tracking-widest">PRIMARY CONTAMINANT</dt>
                  <dd className="text-ash-white text-sm mt-0.5">{report.dominantContamination}</dd>
                </div>
                )}
                {report.secondaryContamination && (
                <div>
                  <dt className="text-stone-gray uppercase text-sm tracking-widest">SECONDARY CONTAMINANT</dt>
                  <dd className="text-ash-white text-sm mt-0.5">{report.secondaryContamination}</dd>
                </div>
                )}
              </dl>
            </div>
            )}

            {/* Decommission Advisory */}
            <div className="border-t border-concrete-border pt-4">
              <h2 className="text-stone-gray font-mono text-sm uppercase tracking-widest mt-2 mb-1.5">
                DECOMMISSION ADVISORY
              </h2>
              <p className="text-ash-white font-mono text-sm">{report.salvageability}</p>
            </div>

            {/* Museum Exhibit Placard */}
            <div className="border-t border-concrete-border pt-4">
              <h2 className="text-stone-gray font-mono text-sm uppercase tracking-widest mt-2 mb-1.5">
                MUSEUM EXHIBIT PLACARD
              </h2>
              <p className="text-ash-white font-mono text-sm italic leading-relaxed">
                {report.museumCaption}
              </p>
            </div>

            {/* Filed by + Chromatic Profile */}
            <div className="border-t border-concrete-border pt-4 flex justify-between items-center">
              <div>
                <span className="text-stone-gray font-mono text-xs uppercase tracking-widest">
                  INCIDENT FILED BY
                </span>
                <p className="text-hazard-amber font-mono text-sm font-bold mt-0.5">
                  {report.anonHandle}
                </p>
              </div>
              <div className="text-right">
                <span className="text-stone-gray font-mono text-xs uppercase tracking-widest">
                  CHROMATIC PROFILE
                </span>
                <p className="text-stone-gray font-mono text-xs mt-0.5 italic">
                  {report.paletteName}
                </p>
              </div>
            </div>

            {/* Share / Distribute */}
            <div className="border-t border-concrete-border pt-4">
              <h2 className="text-stone-gray font-mono text-sm uppercase tracking-widest mt-2 mb-2.5">
                DISTRIBUTE INCIDENT REPORT
              </h2>
              <div className="flex items-center gap-3 flex-wrap">
                {(shareLinks || []).map((link, i) => (
                  <a
                    key={i}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hazard-amber font-mono text-xs font-bold uppercase hover:brightness-125 transition-all"
                  >
                    {link.label}
                  </a>
                ))}
                <button
                  onClick={handleCopy}
                  className="text-stone-gray font-mono text-xs uppercase hover:text-ash-white transition-colors flex items-center gap-1"
                  aria-label={copyState === 'copied' ? 'Copied to clipboard' : 'Extract to clipboard'}
                >
                  {copyState === 'copied' ? (
                    <><Check size={10} aria-hidden="true" /> EXTRACTED</>
                  ) : (
                    <><Copy size={10} aria-hidden="true" /> EXTRACT</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

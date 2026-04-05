import React, { useEffect, useRef, useState } from 'react';
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
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
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
      role="dialog"
      aria-modal="true"
      aria-label="Incident postmortem report"
    >
      {/* Card — full-screen on mobile, constrained modal on desktop */}
      <div className="bg-concrete-light w-full sm:max-w-lg sm:rounded-xl border-t sm:border border-concrete-border shadow-2xl max-h-[100dvh] sm:max-h-[85vh] overflow-y-auto relative">
        {/* Color palette strip — top edge on mobile, left edge on desktop */}
        <div className="hidden sm:flex sm:absolute sm:left-0 sm:top-0 sm:bottom-0 sm:w-2 flex-col sm:rounded-l-xl overflow-hidden" aria-hidden="true">
          {report.dominantColors.map((color, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex sm:hidden h-1.5 w-full" aria-hidden="true">
          {report.dominantColors.map((color, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>

        <div className="sm:ml-2">
          {/* Hazard stripe */}
          <div className="hazard-stripe h-1.5 w-full" />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 sm:top-4 sm:right-4 w-8 h-8 flex items-center justify-center rounded-full bg-concrete-mid/80 text-stone-gray hover:text-ash-white transition-colors z-10"
            aria-label="Close report"
          >
            <X size={16} />
          </button>

          <div className="p-5 sm:p-6 space-y-4">
            {/* Header */}
            <div className="pr-8">
              <h2 className="text-hazard-amber font-mono text-[10px] uppercase tracking-widest">
                INCIDENT POSTMORTEM // DECOMMISSION REPORT
              </h2>
              <p className="text-hazard-amber font-mono text-sm uppercase tracking-widest mt-2 font-bold">
                {report.legacyInfraClass}
              </p>
              <p className="text-ash-white font-mono text-sm leading-snug mt-2">
                {report.damageReport}
              </p>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span
                  className="inline-flex items-center gap-1.5 text-[9px] font-mono text-concrete-light bg-hazard-amber px-2.5 py-1 rounded uppercase font-bold"
                  aria-label={`Severity classification: ${report.smeltRating}`}
                >
                  <AlertTriangle size={10} aria-hidden="true" />
                  {report.smeltRating}
                </span>
                <span className="text-hazard-amber font-mono text-[10px] font-bold">
                  {formatted.value} {formatted.unit} THERMALLY DECOMMISSIONED
                </span>
              </div>
            </div>

            {/* Diagnostic Telemetry */}
            <div className="border-t border-concrete-border pt-4">
              <h3 className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mb-3">
                DIAGNOSTIC TELEMETRY
              </h3>
              <dl className="space-y-2.5 text-[11px] font-mono">
                <div>
                  <dt className="text-stone-gray uppercase text-[10px]">FAILURE ORIGIN ANALYSIS</dt>
                  <dd className="text-ash-white mt-0.5">{report.rootCause}</dd>
                </div>
                <div>
                  <dt className="text-stone-gray uppercase text-[10px]">PRIMARY CONTAMINANT</dt>
                  <dd className="text-ash-white mt-0.5">{report.dominantContamination}</dd>
                </div>
                <div>
                  <dt className="text-stone-gray uppercase text-[10px]">SECONDARY CONTAMINANT</dt>
                  <dd className="text-ash-white mt-0.5">{report.secondaryContamination}</dd>
                </div>
                <div>
                  <dt className="text-stone-gray uppercase text-[10px]">CURSED DIAGNOSIS</dt>
                  <dd className="text-ash-white mt-0.5">{report.cursedDx}</dd>
                </div>
              </dl>
            </div>

            {/* Decommission Advisory */}
            <div className="border-t border-concrete-border pt-4">
              <h3 className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mb-1.5">
                DECOMMISSION ADVISORY
              </h3>
              <p className="text-ash-white font-mono text-[11px]">{report.salvageability}</p>
            </div>

            {/* Museum Exhibit Placard */}
            <div className="border-t border-concrete-border pt-4">
              <h3 className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mb-1.5">
                MUSEUM EXHIBIT PLACARD
              </h3>
              <p className="text-dead-gray font-mono text-[11px] italic leading-relaxed">
                {report.museumCaption}
              </p>
            </div>

            {/* Filed by + Chromatic Profile */}
            <div className="border-t border-concrete-border pt-4 flex justify-between items-center">
              <div>
                <span className="text-stone-gray font-mono text-[9px] uppercase tracking-widest">
                  INCIDENT FILED BY
                </span>
                <p className="text-hazard-amber font-mono text-xs font-bold mt-0.5">
                  {report.anonHandle}
                </p>
              </div>
              <div className="text-right">
                <span className="text-stone-gray font-mono text-[9px] uppercase tracking-widest">
                  CHROMATIC PROFILE
                </span>
                <p className="text-dead-gray font-mono text-[10px] mt-0.5 italic">
                  {report.paletteName}
                </p>
              </div>
            </div>

            {/* Share / Distribute */}
            <div className="border-t border-concrete-border pt-4">
              <h3 className="text-stone-gray font-mono text-[9px] uppercase tracking-widest mb-2.5">
                DISTRIBUTE INCIDENT REPORT
              </h3>
              <div className="flex items-center gap-3 flex-wrap">
                {(shareLinks || []).map((link, i) => (
                  <a
                    key={i}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hazard-amber font-mono text-[10px] font-bold uppercase hover:brightness-125 transition-all"
                  >
                    {link.label}
                  </a>
                ))}
                <button
                  onClick={handleCopy}
                  className="text-stone-gray font-mono text-[10px] uppercase hover:text-ash-white transition-colors flex items-center gap-1"
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

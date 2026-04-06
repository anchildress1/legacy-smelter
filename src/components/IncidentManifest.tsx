import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
} from '../firebase';
import { SmeltLog, GlobalStats } from '../types';
import { formatPixels, getFiveDistinctColors, getLogShareLinks } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { IncidentReportOverlay } from './IncidentReportOverlay';
import { Flame, ArrowLeft } from 'lucide-react';

interface IncidentManifestProps {
  onNavigateHome: () => void;
}

export const IncidentManifest: React.FC<IncidentManifestProps> = ({ onNavigateHome }) => {
  const [logs, setLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({ total_pixels_melted: 0 });
  const [selectedLog, setSelectedLog] = useState<SmeltLog | null>(null);

  useEffect(() => {
    const logsQuery = query(
      collection(db, 'incident_logs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const unsubLogs = onSnapshot(logsQuery, (snapshot) => {
      const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SmeltLog));
      setLogs(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'incident_logs');
    });

    const statsDoc = doc(db, 'global_stats', 'main');
    const unsubStats = onSnapshot(statsDoc, (snapshot) => {
      if (snapshot.exists()) {
        setGlobalStats(snapshot.data() as GlobalStats);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'global_stats/main');
    });

    return () => { unsubLogs(); unsubStats(); };
  }, []);

  const formatted = formatPixels(globalStats.total_pixels_melted);

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      {/* Header */}
      <header className="border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-5xl mx-auto w-full flex flex-col gap-3 px-4 py-4 md:flex-row md:justify-between md:items-center md:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={onNavigateHome}
              className="text-stone-gray hover:text-hazard-amber transition-colors flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:rounded"
            >
              <ArrowLeft size={14} />
              RETURN TO SMELTER
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 w-full md:w-auto md:justify-end">
            <div className="text-right">
              <div className="font-mono font-extrabold text-hazard-amber text-lg leading-none tracking-tight">
                {formatted.value} <span className="text-xs text-stone-gray font-bold">{formatted.unit}</span>
              </div>
              <div className="text-[11px] md:text-[10px] font-mono text-stone-gray uppercase tracking-wide md:tracking-widest mt-0.5">
                DECOMMISSION INDEX
              </div>
            </div>
            <div className="hazard-stripe w-2 h-10 rounded-sm shrink-0" aria-hidden="true" />
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-hazard-amber font-mono text-2xl uppercase tracking-widest font-black">
            GLOBAL INCIDENT MANIFEST
          </h1>
          <p className="text-stone-gray font-mono text-xs md:text-[11px] uppercase tracking-wide leading-relaxed mt-1">
            SELECT ENTRY TO INSPECT POSTMORTEM
          </p>
          <div className="hazard-stripe h-1 w-full mt-4 rounded-sm" />
        </div>

        {/* Log entries */}
        <div className="space-y-3">
          {logs.map((log) => {
            const fmt = formatPixels(log.pixel_count);
            const rawColors = [log.color_1, log.color_2, log.color_3, log.color_4, log.color_5];
            const finalColors = getFiveDistinctColors(rawColors);

            return (
              <button
                key={log.id}
                onClick={() => setSelectedLog(log)}
                className="modern-card relative overflow-hidden flex w-full text-left hover:border-hazard-amber/40 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber"
              >
                {/* Color strip */}
                <div className="w-2 shrink-0 flex flex-col" aria-hidden="true">
                  {finalColors.map((col, idx) => (
                    <div key={idx} className="flex-1" style={{ backgroundColor: col }} />
                  ))}
                </div>

                <div className="p-4 flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0 flex-1">
                      {log.legacy_infra_class && (
                        <p className="text-hazard-amber font-mono text-xs uppercase tracking-wide md:tracking-widest">
                          {log.legacy_infra_class}
                        </p>
                      )}
                      <p className="text-ash-white font-mono text-sm leading-snug mt-1 line-clamp-2">
                        {log.incident_feed_summary}
                      </p>
                    </div>
                    <span className="text-stone-gray group-hover:text-hazard-amber font-mono text-xs uppercase tracking-wide shrink-0 mt-1 transition-colors">
                      INSPECT
                    </span>
                  </div>

                  {/* Meta row */}
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 items-end">
                    <span className="text-hazard-amber font-mono text-xs font-bold">
                      {fmt.value} {fmt.unit} THERMALLY DECOMMISSIONED
                    </span>
                    {log.severity && (
                      <span className="text-stone-gray font-mono text-xs">
                        {log.severity}
                      </span>
                    )}
                    <span className="text-stone-gray font-mono text-xs ml-auto">
                      {log.timestamp?.toDate
                        ? new Date(log.timestamp.toDate()).toLocaleString()
                        : '—'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}

          {logs.length === 0 && (
            <div className="modern-card p-12 text-center">
              <Flame size={32} className="text-hazard-amber mx-auto mb-3" />
              <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                NO INCIDENTS ON RECORD.
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 bg-concrete-mid border-t border-concrete-border mt-auto">
        <div className="max-w-5xl mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs font-mono text-stone-gray uppercase tracking-widest">
            &copy; 2026 Ashley Childress
          </p>
          <p className="text-xs font-mono text-stone-gray uppercase tracking-widest">
            Powered by Gemini
          </p>
        </div>
      </footer>

      {/* Detail overlay */}
      {selectedLog && (
        <IncidentReportOverlay
          log={selectedLog}
          shareLinks={getLogShareLinks(selectedLog)}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
};

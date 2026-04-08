import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
} from '../firebase';
import { SmeltLog, NormalizedSmeltLog, GlobalStats, computeImpact, withVotingDefaults } from '../types';
import { formatPixels, getLogShareLinks } from '../lib/utils';
import { IncidentLogCard } from './IncidentLogCard';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { IncidentReportOverlay } from './IncidentReportOverlay';
import { Flame, ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const PAGE_SIZE = 20;

interface IncidentManifestProps {
  onNavigateHome: () => void;
}

export const IncidentManifest: React.FC<IncidentManifestProps> = ({ onNavigateHome }) => {
  const [allLogs, setAllLogs] = useState<NormalizedSmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({ total_pixels_melted: 0 });
  const [selectedLog, setSelectedLog] = useState<SmeltLog | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubStats = onSnapshot(doc(db, 'global_stats', 'main'), (snap) => {
      if (snap.exists()) setGlobalStats(snap.data() as GlobalStats);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'global_stats/main', setError));

    return () => { unsubStats(); };
  }, []);

  useEffect(() => {
    const logsRef = collection(db, 'incident_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'));

    setIsLoading(true);
    setError(null);
    let gotFirst = false;
    const unsubLogs = onSnapshot(q, (snap) => {
      const entries = snap.docs.map((d) => withVotingDefaults({ id: d.id, ...d.data() } as SmeltLog));
      setAllLogs(entries);
      if (!gotFirst) {
        gotFirst = true;
        setIsLoading(false);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'incident_logs');
      setAllLogs([]);
      setError('Failed to load incidents.');
      setIsLoading(false);
    });

    return () => { unsubLogs(); };
  }, []);

  const sortedLogs = useMemo(() =>
    [...allLogs].sort((a, b) =>
      computeImpact(b.sanction_count, b.escalation_count, b.breach_count)
      - computeImpact(a.sanction_count, a.escalation_count, a.breach_count)
    ),
    [allLogs]
  );

  const totalPages = Math.max(1, Math.ceil(sortedLogs.length / PAGE_SIZE));
  // Clamp page if the dataset shrinks (e.g. docs deleted) while user is on a later page
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageLogs = sortedLogs.slice(pageStart, pageStart + PAGE_SIZE);
  const hasNextPage = safePage < totalPages - 1;

  const goToPreviousPage = () => {
    if (safePage === 0) return;
    setCurrentPage(safePage - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToNextPage = () => {
    if (!hasNextPage) return;
    setCurrentPage(safePage + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatted = formatPixels(globalStats.total_pixels_melted);

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      {/* Header */}
      <header className="border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-5xl mx-auto w-full flex flex-col gap-3 px-4 py-4 sm:flex-row sm:justify-between sm:items-center sm:px-6">
          <div className="flex items-center gap-4">
            <button onClick={onNavigateHome} className="nav-btn">
              <ArrowLeft size={14} />
              RETURN TO SMELTER
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 w-full sm:w-auto sm:justify-end">
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
          <div className="hazard-stripe h-1 w-full mt-4 rounded-sm" />
        </div>

        {/* Log entries */}
        <ul role="list" className="space-y-3 min-h-[200px]">
          {isLoading && (
            <li className="flex items-center justify-center py-12 list-none">
              <div className="w-6 h-6 border-2 border-hazard-amber border-t-transparent rounded-full animate-spin" />
            </li>
          )}

          {!isLoading && pageLogs.map((log) => (
            <li key={log.id}>
              <IncidentLogCard
                log={log}
                onClick={() => setSelectedLog(log)}
              />
            </li>
          ))}

          {!isLoading && sortedLogs.length === 0 && !error && (
            <li className="modern-card p-12 text-center list-none">
              <Flame size={32} className="text-hazard-amber mx-auto mb-3" />
              <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                Furnace idle. Awaiting condemned infrastructure.
              </p>
            </li>
          )}

          {error && (
            <li className="modern-card p-4 list-none">
              <p className="text-hazard-amber font-mono text-xs uppercase tracking-wide">{error}</p>
            </li>
          )}
        </ul>

        {/* Pagination */}
        {totalPages > 1 && (
          <nav aria-label="Incident manifest pages" className="mt-8 flex items-center justify-center gap-1">
            <button
              onClick={goToPreviousPage}
              disabled={safePage === 0}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>

            <div className="min-w-[110px] h-8 px-3 rounded-md border border-concrete-border flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-gray">
              {isLoading && <Loader2 size={12} className="animate-spin text-hazard-amber" aria-hidden="true" />}
              <span>Page {safePage + 1}</span>
            </div>

            <button
              onClick={goToNextPage}
              disabled={!hasNextPage}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </nav>
        )}

        {pageLogs.length > 0 && (
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-widest text-stone-gray">
            Showing incidents {pageStart + 1}–{pageStart + pageLogs.length} of {sortedLogs.length}
          </p>
        )}
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
          incidentId={selectedLog.id}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
};

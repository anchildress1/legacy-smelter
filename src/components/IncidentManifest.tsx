import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
} from '../firebase';
import { SmeltLog, GlobalStats } from '../types';
import { formatPixels, getLogShareLinks } from '../lib/utils';
import { IncidentLogCard } from './IncidentLogCard';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { IncidentReportOverlay } from './IncidentReportOverlay';
import { Flame, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 20;
const MAX_INCIDENTS = 1000;

function getPageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages: (number | '…')[] = [0];
  if (current > 3) pages.push('…');
  for (let i = Math.max(1, current - 2); i <= Math.min(total - 2, current + 2); i++) {
    pages.push(i);
  }
  if (current < total - 4) pages.push('…');
  pages.push(total - 1);
  return pages;
}

interface IncidentManifestProps {
  onNavigateHome: () => void;
}

export const IncidentManifest: React.FC<IncidentManifestProps> = ({ onNavigateHome }) => {
  const [allLogs, setAllLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({ total_pixels_melted: 0 });
  const [selectedLog, setSelectedLog] = useState<SmeltLog | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(allLogs.length / PAGE_SIZE));
  const pageLogs = allLogs.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  useEffect(() => {
    getDocs(query(collection(db, 'incident_logs'), orderBy('timestamp', 'desc'), limit(MAX_INCIDENTS)))
      .then(snap => {
        setAllLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SmeltLog)));
      })
      .catch(err => {
        handleFirestoreError(err, OperationType.LIST, 'incident_logs');
        setError('Failed to load incidents.');
      })
      .finally(() => setIsLoading(false));

    const unsubStats = onSnapshot(doc(db, 'global_stats', 'main'), (snap) => {
      if (snap.exists()) setGlobalStats(snap.data() as GlobalStats);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'global_stats/main'));

    return () => { unsubStats(); };
  }, []);

  const goToPage = (page: number) => {
    if (page === currentPage || page < 0 || page >= totalPages) return;
    setCurrentPage(page);
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
        <div className="space-y-3 min-h-[200px]">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-hazard-amber border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && pageLogs.map((log) => (
            <IncidentLogCard
              key={log.id}
              log={log}
              onClick={() => setSelectedLog(log)}
            />
          ))}

          {!isLoading && allLogs.length === 0 && !error && (
            <div className="modern-card p-12 text-center">
              <Flame size={32} className="text-hazard-amber mx-auto mb-3" />
              <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                Furnace idle. Awaiting condemned infrastructure.
              </p>
            </div>
          )}

          {error && (
            <div className="modern-card p-4">
              <p className="text-hazard-amber font-mono text-xs uppercase tracking-wide">{error}</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <nav aria-label="Incident manifest pages" className="mt-8 flex items-center justify-center gap-1">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 0}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>

            {pageNumbers.map((p, i) =>
              p === '…' ? (
                <span key={`ellipsis-${i}`} className="font-mono text-[11px] text-stone-gray px-1">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => goToPage(p as number)}
                  aria-current={p === currentPage ? 'page' : undefined}
                  className={[
                    'font-mono text-[11px] uppercase tracking-wider min-w-[32px] h-8 rounded-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber',
                    p === currentPage
                      ? 'bg-hazard-amber text-zinc-950 border-hazard-amber font-bold'
                      : 'border-concrete-border text-stone-gray hover:text-hazard-amber hover:border-hazard-amber/40 bg-transparent',
                  ].join(' ')}
                >
                  {(p as number) + 1}
                </button>
              )
            )}

            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages - 1}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </nav>
        )}

        {allLogs.length > 0 && (
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-widest text-stone-gray">
            {allLogs.length} INCIDENTS ARCHIVED
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

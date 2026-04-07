import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from '../firebase';
import { SmeltLog, GlobalStats } from '../types';
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
  const [logs, setLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({ total_pixels_melted: 0 });
  const [selectedLog, setSelectedLog] = useState<SmeltLog | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageStartCursors, setPageStartCursors] = useState<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentPageCursor = pageStartCursors[currentPage] ?? null;

  useEffect(() => {
    const unsubStats = onSnapshot(doc(db, 'global_stats', 'main'), (snap) => {
      if (snap.exists()) setGlobalStats(snap.data() as GlobalStats);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'global_stats/main'));

    return () => { unsubStats(); };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchPage = async () => {
      setIsLoadingPage(true);
      setError(null);
      try {
        const logsRef = collection(db, 'incident_logs');
        const q = currentPageCursor
          ? query(logsRef, orderBy('timestamp', 'desc'), startAfter(currentPageCursor), limit(PAGE_SIZE + 1))
          : query(logsRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE + 1));
        const snap = await getDocs(q);
        if (cancelled) return;

        const pageDocs = snap.docs.slice(0, PAGE_SIZE);
        setLogs(pageDocs.map((d) => ({ id: d.id, ...d.data() } as SmeltLog)));

        const nextExists = snap.docs.length > PAGE_SIZE;
        setHasNextPage(nextExists);
        setPageStartCursors((prev) => {
          const next = prev.slice(0, currentPage + 1);
          if (nextExists && pageDocs.length > 0) {
            next[currentPage + 1] = pageDocs[pageDocs.length - 1];
          }
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        handleFirestoreError(err, OperationType.LIST, 'incident_logs');
        setLogs([]);
        setHasNextPage(false);
        setError('Failed to load incidents.');
      } finally {
        if (!cancelled) setIsLoadingPage(false);
      }
    };

    void fetchPage();
    return () => { cancelled = true; };
  }, [currentPage, currentPageCursor]);

  const goToPreviousPage = () => {
    if (currentPage === 0 || isLoadingPage) return;
    setCurrentPage((page) => page - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToNextPage = () => {
    if (!hasNextPage || isLoadingPage) return;
    setCurrentPage((page) => page + 1);
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
          {isLoadingPage && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-hazard-amber border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!isLoadingPage && logs.map((log) => (
            <IncidentLogCard
              key={log.id}
              log={log}
              onClick={() => setSelectedLog(log)}
            />
          ))}

          {!isLoadingPage && logs.length === 0 && !error && (
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
        {(currentPage > 0 || hasNextPage) && (
          <nav aria-label="Incident manifest pages" className="mt-8 flex items-center justify-center gap-1">
            <button
              onClick={goToPreviousPage}
              disabled={currentPage === 0 || isLoadingPage}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>

            <div className="min-w-[110px] h-8 px-3 rounded-md border border-concrete-border flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-gray">
              {isLoadingPage && <Loader2 size={12} className="animate-spin text-hazard-amber" aria-hidden="true" />}
              <span>Page {currentPage + 1}</span>
            </div>

            <button
              onClick={goToNextPage}
              disabled={!hasNextPage || isLoadingPage}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </nav>
        )}

        {logs.length > 0 && (
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-widest text-stone-gray">
            Showing incidents {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + logs.length}
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

import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
} from '../firebase';
import { SmeltLog, GlobalStats, computeImpact } from '../types';
import { formatPixels, getLogShareLinks } from '../lib/utils';
import { IncidentLogCard } from './IncidentLogCard';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { IncidentReportOverlay } from './IncidentReportOverlay';
import { Flame, ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const PAGE_SIZE = 20;
type ManifestFilter = 'all' | 'needs_ruling' | 'escalated' | 'sanctioned';
type ManifestSort = 'impact' | 'newest' | 'breaches' | 'escalations';

interface IncidentManifestProps {
  onNavigateHome: () => void;
}

export const IncidentManifest: React.FC<IncidentManifestProps> = ({ onNavigateHome }) => {
  const [allLogs, setAllLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({ total_pixels_melted: 0 });
  const [selectedLog, setSelectedLog] = useState<SmeltLog | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [filterMode, setFilterMode] = useState<ManifestFilter>('all');
  const [sortMode, setSortMode] = useState<ManifestSort>('impact');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubStats = onSnapshot(doc(db, 'global_stats', 'main'), (snap) => {
      if (snap.exists()) setGlobalStats(snap.data() as GlobalStats);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'global_stats/main', setError));

    return () => { unsubStats(); };
  }, []);

  // SCALING: subscribes to the full collection for client-side impact sorting.
  // At scale, replace with a precomputed impact_score field and cursor-based pagination.
  useEffect(() => {
    const logsRef = collection(db, 'incident_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'));

    setIsLoading(true);
    setError(null);
    let gotFirst = false;
    const unsubLogs = onSnapshot(q, (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SmeltLog));
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

  const manifestCounts = useMemo(() => ({
    all: allLogs.length,
    needs_ruling: allLogs.filter((log) => !log.judged).length,
    escalated: allLogs.filter((log) => log.escalation_count > 0).length,
    sanctioned: allLogs.filter((log) => log.sanctioned || log.sanction_count > 0).length,
  }), [allLogs]);

  const sortedLogs = useMemo(() => {
    const filtered = allLogs.filter((log) => {
      switch (filterMode) {
        case 'needs_ruling':
          return !log.judged;
        case 'escalated':
          return log.escalation_count > 0;
        case 'sanctioned':
          return log.sanctioned || log.sanction_count > 0;
        default:
          return true;
      }
    });

    return filtered.sort((a, b) => {
      switch (sortMode) {
        case 'newest':
          return (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0);
        case 'breaches':
          return b.breach_count - a.breach_count || computeImpact(b.sanction_count, b.escalation_count, b.breach_count)
            - computeImpact(a.sanction_count, a.escalation_count, a.breach_count);
        case 'escalations':
          return b.escalation_count - a.escalation_count || computeImpact(b.sanction_count, b.escalation_count, b.breach_count)
            - computeImpact(a.sanction_count, a.escalation_count, a.breach_count);
        case 'impact':
        default:
          return computeImpact(b.sanction_count, b.escalation_count, b.breach_count)
            - computeImpact(a.sanction_count, a.escalation_count, a.breach_count);
      }
    });
  }, [allLogs, filterMode, sortMode]);

  useEffect(() => {
    setCurrentPage(0);
  }, [filterMode, sortMode]);

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

        <div className="mb-6 grid gap-4 rounded-xl border border-concrete-border bg-concrete-light/70 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <p className="text-stone-gray font-mono text-[10px] uppercase tracking-[0.2em]">Filter</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                ['all', 'All Incidents'],
                ['needs_ruling', 'Needs Ruling'],
                ['escalated', 'Escalated'],
                ['sanctioned', 'Sanctioned'],
              ] as [ManifestFilter, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilterMode(value)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    filterMode === value
                      ? 'border-hazard-amber/40 bg-hazard-amber/10 text-hazard-amber'
                      : 'border-concrete-border bg-concrete-mid text-stone-gray hover:text-ash-white'
                  }`}
                >
                  <span>{label}</span>
                  <span className="text-[9px] text-stone-gray">{manifestCounts[value]}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-stone-gray font-mono text-[10px] uppercase tracking-[0.2em]">Sort</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as ManifestSort)}
              className="mt-2 w-full rounded-lg border border-concrete-border bg-concrete-mid px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ash-white focus:border-hazard-amber focus:outline-none"
            >
              <option value="impact">Highest Impact</option>
              <option value="newest">Newest First</option>
              <option value="breaches">Most Breaches</option>
              <option value="escalations">Most Escalations</option>
            </select>
          </label>
        </div>

        {!isLoading && !error && sortedLogs.length > 0 && (
          <p className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-stone-gray">
            {sortedLogs.length} incident{sortedLogs.length === 1 ? '' : 's'}
          </p>
        )}

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
                {filterMode === 'all' && 'Furnace idle. Awaiting condemned infrastructure.'}
                {filterMode === 'needs_ruling' && 'All incidents have been ruled on.'}
                {filterMode === 'escalated' && 'No escalated incidents on record.'}
                {filterMode === 'sanctioned' && 'No sanctions issued yet.'}
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

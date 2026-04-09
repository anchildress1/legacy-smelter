import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
} from '../firebase';
import { SmeltLog, GlobalStats, computeImpact } from '../types';
import { getLogShareLinks } from '../lib/utils';
import { IncidentLogCard } from './IncidentLogCard';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { IncidentReportOverlay } from './IncidentReportOverlay';
import { DecommissionIndex } from './DecommissionIndex';
import { SiteFooter } from './SiteFooter';
import { Flame, ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { parseSmeltLog } from '../lib/smeltLogSchema';

const PAGE_SIZE = 20;
const MANIFEST_FETCH_LIMIT = 500;
type ManifestFilter = 'all' | 'needs_ruling' | 'escalated' | 'sanctioned';
type ManifestSort = 'impact' | 'newest' | 'breaches' | 'escalations';
const MANIFEST_SCHEMA_ERROR_PREFIX = 'Incident data schema violation.';
const GLOBAL_STATS_SCHEMA_ERROR_PREFIX = 'Global stats schema violation.';

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
      if (!snap.exists()) return;
      const data = snap.data();
      if (typeof data.total_pixels_melted !== 'number' || !Number.isFinite(data.total_pixels_melted)) {
        console.error('[IncidentManifest] global_stats/main has invalid total_pixels_melted:', data);
        setError(`${GLOBAL_STATS_SCHEMA_ERROR_PREFIX} Decommission Index frozen.`);
        return;
      }
      setGlobalStats({ total_pixels_melted: data.total_pixels_melted });
      setError((prev) => (
        prev?.startsWith(GLOBAL_STATS_SCHEMA_ERROR_PREFIX) ? null : prev
      ));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'global_stats/main', setError));

    return () => { unsubStats(); };
  }, []);

  // Keep manifest reads bounded and use server-side ranking for the selected
  // sort mode so client CPU/memory does not scale with collection size.
  useEffect(() => {
    const logsRef = collection(db, 'incident_logs');
    const q = (() => {
      switch (sortMode) {
        case 'impact':
          return query(logsRef, orderBy('impact_score', 'desc'), orderBy('timestamp', 'desc'), limit(MANIFEST_FETCH_LIMIT));
        case 'breaches':
          return query(logsRef, orderBy('breach_count', 'desc'), orderBy('timestamp', 'desc'), limit(MANIFEST_FETCH_LIMIT));
        case 'escalations':
          return query(logsRef, orderBy('escalation_count', 'desc'), orderBy('timestamp', 'desc'), limit(MANIFEST_FETCH_LIMIT));
        case 'newest':
        default:
          return query(logsRef, orderBy('timestamp', 'desc'), limit(MANIFEST_FETCH_LIMIT));
      }
    })();

    setIsLoading(true);
    setError(null);
    let gotFirst = false;
    const unsubLogs = onSnapshot(q, (snap) => {
      const entries: SmeltLog[] = [];
      let schemaErrors = 0;
      for (const d of snap.docs) {
        try {
          entries.push(parseSmeltLog(d.id, d.data()));
        } catch (parseErr) {
          schemaErrors++;
          if (schemaErrors <= 3) console.error('[IncidentManifest] Skipping malformed doc:', parseErr);
        }
      }
      if (schemaErrors > 0) {
        const incidentWord = schemaErrors === 1 ? 'incident' : 'incidents';
        setError(`${MANIFEST_SCHEMA_ERROR_PREFIX} ${schemaErrors} ${incidentWord} hidden from manifest.`);
      } else {
        setError((prev) => (
          prev?.startsWith(MANIFEST_SCHEMA_ERROR_PREFIX) ? null : prev
        ));
      }
      setAllLogs(entries);
      if (!gotFirst) {
        gotFirst = true;
        setIsLoading(false);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'incident_logs', setError);
      setAllLogs([]);
      setIsLoading(false);
    });

    return () => { unsubLogs(); };
  }, [sortMode]);

  const manifestCounts = useMemo(() => ({
    all: allLogs.length,
    needs_ruling: allLogs.filter((log) => !log.judged).length,
    escalated: allLogs.filter((log) => log.escalation_count > 0).length,
    sanctioned: allLogs.filter((log) => log.sanctioned).length,
  }), [allLogs]);

  const sortedLogs = useMemo(() => {
    const filtered = allLogs.filter((log) => {
      switch (filterMode) {
        case 'needs_ruling':
          return !log.judged;
        case 'escalated':
          return log.escalation_count > 0;
        case 'sanctioned':
          return log.sanctioned;
        default:
          return true;
      }
    });

    return filtered.sort((a, b) => {
      switch (sortMode) {
        case 'newest':
          return b.timestamp.toMillis() - a.timestamp.toMillis();
        case 'breaches':
          return b.breach_count - a.breach_count || computeImpact(b) - computeImpact(a);
        case 'escalations':
          return b.escalation_count - a.escalation_count || computeImpact(b) - computeImpact(a);
        case 'impact':
        default:
          return computeImpact(b) - computeImpact(a);
      }
    });
  }, [allLogs, filterMode, sortMode]);

  useEffect(() => {
    setCurrentPage(0);
  }, [filterMode, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sortedLogs.length / PAGE_SIZE));
  const isWindowTruncated = allLogs.length === MANIFEST_FETCH_LIMIT;
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

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      {/* Header */}
      <header className="border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-5xl mx-auto w-full flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
          <button onClick={onNavigateHome} className="nav-btn">
            <ArrowLeft size={14} />
            RETURN TO SMELTER
          </button>
          <DecommissionIndex totalPixels={globalStats.total_pixels_melted} />
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full">
        {/* Page title */}
        <div className="mb-5">
          <h1 className="text-hazard-amber font-mono text-lg sm:text-2xl uppercase tracking-widest font-black">
            Incident Manifest{!isLoading && <span className="text-stone-gray font-bold text-sm sm:text-base ml-2">({sortedLogs.length})</span>}
          </h1>
          {isWindowTruncated && (
            <p className="mt-1 text-stone-gray font-mono text-[10px] uppercase tracking-wider">
              Showing newest {MANIFEST_FETCH_LIMIT} incidents.
            </p>
          )}
          <div className="hazard-stripe h-1 w-full mt-3 rounded-sm" />
        </div>

        {/* Filter + sort — flat, no container */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {([
            ['all', 'All'],
            ['needs_ruling', 'Needs Ruling'],
            ['escalated', 'Escalated'],
            ['sanctioned', 'Sanctioned'],
          ] as [ManifestFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterMode(value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                filterMode === value
                  ? 'border-hazard-amber/40 bg-hazard-amber/10 text-hazard-amber'
                  : 'border-[#444] bg-[#1a1a1a] text-stone-gray hover:text-ash-white hover:border-[#555]'
              }`}
            >
              {label}
              <span className="text-[9px] opacity-60">{manifestCounts[value]}</span>
            </button>
          ))}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as ManifestSort)}
            className="ml-auto rounded-md border border-[#333] bg-transparent px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-stone-gray focus:border-hazard-amber focus:outline-none"
          >
            <option value="impact">Highest Impact</option>
            <option value="newest">Newest First</option>
            <option value="breaches">Most Breaches</option>
            <option value="escalations">Most Escalations</option>
          </select>
        </div>

        {/* Log entries */}
        <ul className="space-y-4 min-h-[200px]">
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
            <li className="py-12 text-center list-none">
              <Flame size={28} className="text-hazard-amber mx-auto mb-2" />
              <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                {filterMode === 'all' && 'Furnace idle. Awaiting condemned infrastructure.'}
                {filterMode === 'needs_ruling' && 'All incidents have been ruled on.'}
                {filterMode === 'escalated' && 'No escalated incidents on record.'}
                {filterMode === 'sanctioned' && 'No sanctions issued yet.'}
              </p>
            </li>
          )}

          {error && (
            <li className="py-4 list-none">
              <p className="text-hazard-amber font-mono text-xs uppercase tracking-wide">{error}</p>
            </li>
          )}
        </ul>

        {/* Pagination + count */}
        <nav aria-label="Incident manifest pages" className="mt-6 flex items-center justify-center gap-1">
          {totalPages > 1 && (
            <button
              onClick={goToPreviousPage}
              disabled={safePage === 0}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
          )}

          <div className="min-w-[90px] h-8 px-3 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-gray">
            {isLoading && <Loader2 size={12} className="animate-spin text-hazard-amber" aria-hidden="true" />}
            {totalPages > 1 && <span>{safePage + 1} / {totalPages}</span>}
            {!isLoading && <span className={totalPages > 1 ? 'opacity-50' : ''}>{sortedLogs.length} {sortedLogs.length === 1 ? 'incident' : 'incidents'}</span>}
          </div>

          {totalPages > 1 && (
            <button
              onClick={goToNextPage}
              disabled={!hasNextPage}
              className="nav-btn disabled:opacity-30 disabled:cursor-not-allowed px-2"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </nav>
      </main>

      <SiteFooter maxWidth="max-w-5xl" />

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

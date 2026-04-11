import React, { useState, useEffect, useMemo } from 'react';
import { SmeltLog, computeImpact } from '../types';
import { getLogShareLinks } from '../lib/utils';
import { IncidentLogCard } from './IncidentLogCard';
import { IncidentReportOverlay } from './IncidentReportOverlay';
import { DecommissionIndex } from './DecommissionIndex';
import { SiteFooter } from './SiteFooter';
import { DataHealthIndicator } from './DataHealthIndicator';
import { Flame, ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useGlobalStats } from '../hooks/useGlobalStats';
import {
  useManifestLogs,
  MANIFEST_FETCH_LIMIT,
  type ManifestSortMode,
} from '../hooks/useManifestLogs';
import { useRecentIncidentLogs } from '../hooks/useRecentIncidentLogs';

const PAGE_SIZE = 20;
type ManifestFilter = 'all' | 'escalated' | 'sanctioned';
type ManifestSort = ManifestSortMode;

interface IncidentManifestProps {
  onNavigateHome: () => void;
}

export const IncidentManifest: React.FC<IncidentManifestProps> = ({ onNavigateHome }) => {
  const { globalStats, statsIssue } = useGlobalStats({
    source: 'IncidentManifest',
  });
  const [selectedLog, setSelectedLog] = useState<SmeltLog | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [filterMode, setFilterMode] = useState<ManifestFilter>('all');
  const [sortMode, setSortMode] = useState<ManifestSort>('impact');
  const { allLogs, isLoading, manifestIssue } = useManifestLogs(sortMode);
  // Mirror the home queue's top-3 subscription here so the manifest
  // can mark the same incidents as P0 regardless of the user's
  // current filter or sort. Using the exact same hook guarantees
  // the two surfaces agree on "who is in the top 3" — impact desc,
  // then timestamp desc — without the manifest having to redo the
  // sort or care whether its own `allLogs` window is wide enough.
  const { recentLogs: topPriorityLogs } = useRecentIncidentLogs({
    source: 'IncidentManifest',
  });
  const topPriorityIds = useMemo(
    () => new Set(topPriorityLogs.map((log) => log.id)),
    [topPriorityLogs],
  );

  const manifestCounts = useMemo(() => ({
    all: allLogs.length,
    escalated: allLogs.filter((log) => log.escalation_count > 0).length,
    sanctioned: allLogs.filter((log) => log.sanctioned).length,
  }), [allLogs]);

  const sortedLogs = useMemo(() => {
    const filtered = allLogs.filter((log) => {
      switch (filterMode) {
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
  const activeIssues = [statsIssue, manifestIssue].filter((message): message is string => !!message);
  // Clamp page if the dataset shrinks (e.g. docs deleted) while user is on a later page
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageLogs = sortedLogs.slice(pageStart, pageStart + PAGE_SIZE);
  const hasNextPage = safePage < totalPages - 1;

  const goToPreviousPage = () => {
    if (safePage === 0) return;
    setCurrentPage(safePage - 1);
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToNextPage = () => {
    if (!hasNextPage) return;
    setCurrentPage(safePage + 1);
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
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
          <div className="flex items-center gap-2 sm:gap-4">
            <DataHealthIndicator issues={activeIssues} />
            <DecommissionIndex totalPixels={globalStats.total_pixels_melted} />
          </div>
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
            ['escalated', 'Escalated'],
            ['sanctioned', 'Sanctioned'],
          ] as [ManifestFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterMode(value)}
              aria-pressed={filterMode === value}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:ring-inset ${
                filterMode === value
                  ? 'border-hazard-amber/70 bg-hazard-amber/20 text-hazard-amber'
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
            aria-label="Sort incidents"
            className="ml-auto rounded-full border border-[#444] bg-[#1a1a1a] px-3.5 py-2 font-mono text-[10px] uppercase tracking-widest text-stone-gray focus:border-hazard-amber focus:outline-none"
          >
            <option value="impact">P0 Impact (Highest First)</option>
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
                showP0Badge={topPriorityIds.has(log.id)}
                onClick={() => setSelectedLog(log)}
              />
            </li>
          ))}

          {!isLoading && sortedLogs.length === 0 && (
            <li className="py-12 text-center list-none">
              <Flame size={28} className="text-hazard-amber mx-auto mb-2" />
              <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                {filterMode === 'all' && 'Furnace idle. Awaiting condemned infrastructure.'}
                {filterMode === 'escalated' && 'No escalated incidents on record.'}
                {filterMode === 'sanctioned' && 'No sanctions issued yet.'}
              </p>
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
          showP0Badge={topPriorityIds.has(selectedLog.id)}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
};

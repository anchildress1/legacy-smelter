import { useEffect, useState } from 'react';
import { db, doc, onSnapshot } from '../firebase';
import type { GlobalStats } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';

export const DEFAULT_STATS_SCHEMA_ISSUE =
  'GLOBAL STATS DATA SCHEMA VIOLATION. DECOMMISSION INDEX FROZEN.';

interface UseGlobalStatsOptions {
  readonly source: string;
  readonly schemaIssueCopy?: string;
}

interface UseGlobalStatsResult {
  readonly globalStats: GlobalStats;
  readonly statsIssue: string | null;
}

export function useGlobalStats({
  source,
  schemaIssueCopy = DEFAULT_STATS_SCHEMA_ISSUE,
}: UseGlobalStatsOptions): UseGlobalStatsResult {
  const [globalStats, setGlobalStats] = useState<GlobalStats>({
    total_pixels_melted: 0,
  });
  const [statsIssue, setStatsIssue] = useState<string | null>(null);

  useEffect(() => {
    const unsubStats = onSnapshot(
      doc(db, 'global_stats', 'main'),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (
          typeof data.total_pixels_melted !== 'number' ||
          !Number.isFinite(data.total_pixels_melted)
        ) {
          console.error(
            `[${source}] global_stats/main has invalid total_pixels_melted:`,
            data,
          );
          setStatsIssue(schemaIssueCopy);
          return;
        }
        setGlobalStats({ total_pixels_melted: data.total_pixels_melted });
        setStatsIssue(null);
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          'global_stats/main',
          setStatsIssue,
        ),
    );

    return () => {
      unsubStats();
    };
  }, [schemaIssueCopy, source]);

  return { globalStats, statsIssue };
}

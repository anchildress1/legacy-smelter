import { useEffect, useState } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
} from '../firebase';
import type { SmeltLog } from '../types';
import { parseSmeltLogBatch } from '../lib/smeltLogSchema';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';

export type ManifestSortMode =
  | 'impact'
  | 'newest'
  | 'breaches'
  | 'escalations';

export const MANIFEST_FETCH_LIMIT = 500;
export const MANIFEST_SCHEMA_ISSUE_PREFIX =
  'INCIDENT DATA SCHEMA VIOLATION.';

interface UseManifestLogsResult {
  readonly allLogs: SmeltLog[];
  readonly isLoading: boolean;
  readonly manifestIssue: string | null;
}

export function useManifestLogs(sortMode: ManifestSortMode): UseManifestLogsResult {
  const [allLogs, setAllLogs] = useState<SmeltLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [manifestIssue, setManifestIssue] = useState<string | null>(null);

  useEffect(() => {
    const logsRef = collection(db, 'incident_logs');
    const q = (() => {
      switch (sortMode) {
        case 'impact':
          return query(
            logsRef,
            orderBy('impact_score', 'desc'),
            orderBy('timestamp', 'desc'),
            limit(MANIFEST_FETCH_LIMIT),
          );
        case 'breaches':
          return query(
            logsRef,
            orderBy('breach_count', 'desc'),
            orderBy('timestamp', 'desc'),
            limit(MANIFEST_FETCH_LIMIT),
          );
        case 'escalations':
          return query(
            logsRef,
            orderBy('escalation_count', 'desc'),
            orderBy('timestamp', 'desc'),
            limit(MANIFEST_FETCH_LIMIT),
          );
        case 'newest':
        default:
          return query(logsRef, orderBy('timestamp', 'desc'), limit(MANIFEST_FETCH_LIMIT));
      }
    })();

    setIsLoading(true);
    setManifestIssue(null);
    let gotFirst = false;
    const unsubLogs = onSnapshot(
      q,
      (snap) => {
        const { entries, invalidCount } = parseSmeltLogBatch(snap.docs, {
          source: 'IncidentManifest',
        });
        setAllLogs(entries);
        if (invalidCount > 0) {
          const noun = invalidCount === 1 ? 'incident' : 'incidents';
          setManifestIssue(
            `${MANIFEST_SCHEMA_ISSUE_PREFIX} ${invalidCount} ${noun} hidden from manifest due to invalid schema.`,
          );
        } else {
          setManifestIssue(null);
        }
        if (!gotFirst) {
          gotFirst = true;
          setIsLoading(false);
        }
      },
      (err) => {
        handleFirestoreError(
          err,
          OperationType.LIST,
          'incident_logs',
          setManifestIssue,
        );
        setAllLogs([]);
        setIsLoading(false);
      },
    );

    return () => {
      unsubLogs();
    };
  }, [sortMode]);

  return { allLogs, isLoading, manifestIssue };
}

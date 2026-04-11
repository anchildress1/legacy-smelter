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

export const DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX =
  'INCIDENT DATA SCHEMA VIOLATION.';

interface UseRecentIncidentLogsOptions {
  readonly limitCount?: number;
  readonly source?: string;
  readonly schemaIssuePrefix?: string;
}

interface UseRecentIncidentLogsResult {
  readonly recentLogs: SmeltLog[];
  readonly queueIssue: string | null;
}

export function useRecentIncidentLogs({
  limitCount = 3,
  source = 'App',
  schemaIssuePrefix = DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX,
}: UseRecentIncidentLogsOptions = {}): UseRecentIncidentLogsResult {
  const [recentLogs, setRecentLogs] = useState<SmeltLog[]>([]);
  const [queueIssue, setQueueIssue] = useState<string | null>(null);

  useEffect(() => {
    const logsQuery = query(
      collection(db, 'incident_logs'),
      orderBy('impact_score', 'desc'),
      orderBy('timestamp', 'desc'),
      limit(limitCount),
    );

    const unsubLogs = onSnapshot(
      logsQuery,
      (snapshot) => {
        const { entries, invalidCount } = parseSmeltLogBatch(snapshot.docs, {
          source,
        });
        setRecentLogs(entries);
        if (invalidCount > 0) {
          const noun = invalidCount === 1 ? 'incident' : 'incidents';
          setQueueIssue(
            `${schemaIssuePrefix} ${invalidCount} ${noun} hidden from queue due to invalid schema.`,
          );
        } else {
          setQueueIssue(null);
        }
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          'incident_logs',
          setQueueIssue,
        );
      },
    );

    return () => {
      unsubLogs();
    };
  }, [limitCount, schemaIssuePrefix, source]);

  return { recentLogs, queueIssue };
}

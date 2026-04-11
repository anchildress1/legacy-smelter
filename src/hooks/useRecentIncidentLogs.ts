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
  /**
   * `true` once the Firestore subscription has delivered its first
   * callback (success OR error). Consumers that need to distinguish
   * "queue empty" from "queue not yet loaded" should gate decisions on
   * this flag — for example, the deep-link overlay in App.tsx delays
   * opening until the top-3 set is known so the P0 badge does not
   * flash false-then-true for a deep-linked incident. The flag stays
   * `true` once set; subsequent snapshot updates just replace
   * `recentLogs` in place.
   */
  readonly loaded: boolean;
}

export function useRecentIncidentLogs({
  limitCount = 3,
  source = 'App',
  schemaIssuePrefix = DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX,
}: UseRecentIncidentLogsOptions = {}): UseRecentIncidentLogsResult {
  const [recentLogs, setRecentLogs] = useState<SmeltLog[]>([]);
  const [queueIssue, setQueueIssue] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Reset the loaded sentinel when the query inputs change (e.g. a
    // different `limitCount`) so consumers see a clean "not yet
    // loaded" state for the new subscription before its first
    // callback fires.
    setLoaded(false);

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
        setLoaded(true);
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          'incident_logs',
          setQueueIssue,
        );
        // Mark as loaded even on error so consumers gated on the
        // sentinel do not hang forever when Firestore is unreachable.
        // `queueIssue` carries the failure detail; a DataHealthIndicator
        // surface will still show the user why the top-3 is empty.
        setLoaded(true);
      },
    );

    return () => {
      unsubLogs();
    };
  }, [limitCount, schemaIssuePrefix, source]);

  return { recentLogs, queueIssue, loaded };
}

import { useEffect, useState } from 'react';
import { db, doc, onSnapshot } from '../firebase';

export interface LiveCounts {
  sanction: number;
  breach: number;
  escalation: number;
  timestamp: Date | null;
}

export interface LiveIncidentCountsSeed {
  sanctionCount: number;
  breachCount: number;
  escalationCount: number;
  timestamp: Date | null;
}

export type LiveCountsStaleReason =
  | 'removed'
  | 'schema'
  | 'subscription'
  | null;

export interface LiveCountsResult {
  readonly counts: LiveCounts;
  readonly staleReason: LiveCountsStaleReason;
}

export function staleReasonCopy(reason: LiveCountsStaleReason): string | null {
  switch (reason) {
    case 'removed':
      return 'LIVE COUNTS STALE. INCIDENT REMOVED FROM ARCHIVE.';
    case 'schema':
      return 'LIVE COUNTS STALE. ARCHIVE SCHEMA DRIFT.';
    case 'subscription':
      return 'LIVE COUNTS STALE. SUBSCRIPTION ERRORED.';
    default:
      return null;
  }
}

export function useLiveIncidentCounts(
  incidentId: string | null | undefined,
  seed: LiveIncidentCountsSeed | null,
): LiveCountsResult {
  const [counts, setCounts] = useState<LiveCounts>(() => ({
    sanction: seed?.sanctionCount ?? 0,
    breach: seed?.breachCount ?? 0,
    escalation: seed?.escalationCount ?? 0,
    timestamp: seed?.timestamp ?? null,
  }));
  const [staleReason, setStaleReason] = useState<LiveCountsStaleReason>(null);

  useEffect(() => {
    setCounts({
      sanction: seed?.sanctionCount ?? 0,
      breach: seed?.breachCount ?? 0,
      escalation: seed?.escalationCount ?? 0,
      timestamp: seed?.timestamp ?? null,
    });
    setStaleReason(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  useEffect(() => {
    if (!incidentId) return;
    return onSnapshot(
      doc(db, 'incident_logs', incidentId),
      (snap) => {
        if (!snap.exists()) {
          console.error(
            `[IncidentReportOverlay] incident_logs/${incidentId} removed from archive while overlay open.`,
          );
          setStaleReason('removed');
          return;
        }
        const data = snap.data();
        const sc = data.sanction_count;
        const bc = data.breach_count;
        const ec = data.escalation_count;
        if (
          !Number.isFinite(sc) ||
          !Number.isFinite(bc) ||
          !Number.isFinite(ec) ||
          sc < 0 ||
          bc < 0 ||
          ec < 0
        ) {
          console.error(
            `[IncidentReportOverlay] incident_logs/${incidentId} has invalid counter fields`,
            {
              sanction_count: sc,
              breach_count: bc,
              escalation_count: ec,
            },
          );
          setStaleReason('schema');
          return;
        }
        const ts = data.timestamp;
        const nextTimestamp =
          ts && typeof ts.toDate === 'function' ? (ts.toDate() as Date) : null;
        setCounts({
          sanction: sc,
          breach: bc,
          escalation: ec,
          timestamp: nextTimestamp,
        });
        setStaleReason(null);
      },
      (error) => {
        console.error(
          '[IncidentReportOverlay] Live count subscription failed:',
          error,
        );
        setStaleReason('subscription');
      },
    );
  }, [incidentId]);

  return { counts, staleReason };
}

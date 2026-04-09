import { useState, useEffect } from 'react';
import { toggleEscalation, hasEscalated, syncEscalationState } from '../services/escalationService';

export interface UseEscalationResult {
  /** Whether the current user has escalated this incident. Starts from the
   *  localStorage cache, then is overwritten by the Firestore sync. */
  readonly escalated: boolean;
  /** True while a toggle request is in flight — use to disable the button. */
  readonly isToggling: boolean;
  /** User-facing error message from the most recent sync or toggle. Cleared
   *  automatically on the next sync or toggle attempt; callers should render
   *  it as long as it is non-null. */
  readonly error: string | null;
  /** Flip the escalation state. Optimistically updates, rolls back on
   *  failure, and populates `error` on rejection. */
  readonly toggle: () => Promise<void>;
}

/**
 * React hook that owns a single incident's escalation state for the current
 * anonymous user. On mount it reads the localStorage cache synchronously
 * (so the UI paints immediately) and then kicks off a Firestore sync to
 * replace that value with the authoritative state from the
 * `incident_logs/{id}/escalations/{uid}` subcollection. Both the sync and
 * the toggle surface failures via the returned `error` string — callers
 * MUST render it; there is no silent fallback.
 */
export function useEscalation(incidentId: string | null): UseEscalationResult {
  const [escalated, setEscalated] = useState(() => incidentId ? hasEscalated(incidentId) : false);
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!incidentId) {
      setEscalated(false);
      setError(null);
      return;
    }
    setEscalated(hasEscalated(incidentId));
    setError(null);
    let cancelled = false;
    syncEscalationState(incidentId)
      .then((state) => { if (!cancelled) setEscalated(state); })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useEscalation] syncEscalationState failed:', err);
        setError('Could not verify escalation state. Count may be stale.');
      });
    return () => { cancelled = true; };
  }, [incidentId]);

  const toggle = async () => {
    if (!incidentId || isToggling) return;
    setIsToggling(true);
    setError(null);
    const previous = escalated;
    const optimistic = !previous;
    setEscalated(optimistic);
    try {
      const actual = await toggleEscalation(incidentId);
      if (actual !== optimistic) setEscalated(actual);
    } catch (err) {
      setEscalated(previous);
      console.error('[useEscalation] Toggle failed:', err);
      setError('Escalation failed. Check your connection and retry.');
    } finally {
      setIsToggling(false);
    }
  };

  return { escalated, isToggling, error, toggle };
}

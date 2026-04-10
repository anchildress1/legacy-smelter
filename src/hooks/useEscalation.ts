import { useState, useEffect, useRef } from 'react';
import {
  toggleEscalation,
  hasEscalated,
  syncEscalationState,
  subscribeEscalationStateChange,
} from '../services/escalationService';

export interface UseEscalationResult {
  /** Whether the current user has escalated this incident. Starts from the
   *  localStorage cache, then is overwritten by the Firestore sync. */
  readonly escalated: boolean;
  /** True while a toggle request is in flight — use to disable the button. */
  readonly isToggling: boolean;
  /** Flip the escalation state. Optimistically updates and rolls back on
   *  failure. Failures are logged to the console only — there is no
   *  user-facing error surface. */
  readonly toggle: () => Promise<void>;
}

/**
 * React hook that owns a single incident's escalation state for the current
 * anonymous user. On mount it reads the localStorage cache synchronously
 * (so the UI paints immediately) and then kicks off a Firestore sync to
 * replace that value with the authoritative state from the
 * `incident_logs/{id}/escalations/{uid}` subcollection. Both the sync and
 * the toggle log failures to the console only — there is no user-facing
 * error display.
 */
export function useEscalation(incidentId: string | null): UseEscalationResult {
  const [escalated, setEscalated] = useState(() => incidentId ? hasEscalated(incidentId) : false);
  const [isToggling, setIsToggling] = useState(false);
  const localMutationEpochRef = useRef(0);

  useEffect(() => {
    if (!incidentId) {
      setEscalated(false);
      return;
    }
    // Bump epoch on incident change so in-flight sync from the previous incident
    // can never be applied to the new one.
    localMutationEpochRef.current += 1;
    const syncEpoch = localMutationEpochRef.current;
    setEscalated(hasEscalated(incidentId));
    let cancelled = false;
    syncEscalationState(incidentId)
      .then((state) => {
        if (cancelled) return;
        // Ignore stale sync responses if a local toggle happened after this sync started.
        if (localMutationEpochRef.current !== syncEpoch) return;
        setEscalated(state);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useEscalation] syncEscalationState failed:', err);
      });
    const unsubscribe = subscribeEscalationStateChange(({ incidentId: changedIncidentId, escalated: nextState }) => {
      if (changedIncidentId !== incidentId) return;
      if (!cancelled) setEscalated(nextState);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [incidentId]);

  const toggle = async () => {
    if (!incidentId || isToggling) return;
    setIsToggling(true);
    localMutationEpochRef.current += 1;
    const previous = escalated;
    const optimistic = !previous;
    setEscalated(optimistic);
    try {
      const actual = await toggleEscalation(incidentId);
      if (actual !== optimistic) setEscalated(actual);
    } catch (err) {
      setEscalated(previous);
      console.error('[useEscalation] Toggle failed:', err);
    } finally {
      setIsToggling(false);
    }
  };

  return { escalated, isToggling, toggle };
}

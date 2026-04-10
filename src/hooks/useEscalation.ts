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
  /** The most recent toggle error, or `null` if the last call succeeded or
   *  no toggle has been attempted. Callers should surface this via UI so
   *  the user knows the optimistic flip was rolled back. The error is
   *  cleared on the next successful (or in-flight) toggle. */
  readonly toggleError: Error | null;
  /** Flip the escalation state. Optimistically updates and rolls back on
   *  failure. The hook exposes `toggleError` so callers can render the
   *  failure to the user — relying on console-only logging silently hides
   *  write failures from the person clicking the button. */
  readonly toggle: () => Promise<void>;
}

/**
 * React hook that owns a single incident's escalation state for the current
 * anonymous user. On mount it reads the localStorage cache synchronously
 * (so the UI paints immediately) and then kicks off a Firestore sync to
 * replace that value with the authoritative state from the
 * `incident_logs/{id}/escalations/{uid}` subcollection. Sync failures are
 * logged to the console (the stale cache is still shown); toggle failures
 * are surfaced via `toggleError` so the UI can render the rollback.
 */
export function useEscalation(incidentId: string | null): UseEscalationResult {
  const [escalated, setEscalated] = useState(() => incidentId ? hasEscalated(incidentId) : false);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleError, setToggleError] = useState<Error | null>(null);
  const localMutationEpochRef = useRef(0);
  const activeToggleRequestRef = useRef(0);
  // Synchronous re-entry guard. `isToggling` state cannot be used here
  // because React state updates are async — two rapid calls in the same
  // tick would both observe `isToggling === false` and start concurrent
  // toggles (double writes + conflicting optimistic UI). The ref flips
  // before any await, so the second call sees the guard immediately.
  const toggleInFlightRef = useRef(false);

  useEffect(() => {
    // Any incident switch invalidates stale async completions from the previous
    // incident. This includes toggles still in-flight.
    localMutationEpochRef.current += 1;
    activeToggleRequestRef.current += 1;
    toggleInFlightRef.current = false;
    setIsToggling(false);
    setToggleError(null);

    if (!incidentId) {
      setEscalated(false);
      return;
    }

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
      if (cancelled) return;
      // Invalidate any in-flight sync started before this event so stale
      // responses cannot overwrite a newer user-driven state.
      localMutationEpochRef.current += 1;
      setEscalated(nextState);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [incidentId]);

  const toggle = async () => {
    if (!incidentId) return;
    // Synchronous guard flips BEFORE any state update so a second call in
    // the same tick returns immediately. Do not use `isToggling` here — React
    // state updates are async and the closure would still see `false`.
    if (toggleInFlightRef.current) return;
    toggleInFlightRef.current = true;
    setIsToggling(true);
    setToggleError(null);
    localMutationEpochRef.current += 1;
    activeToggleRequestRef.current += 1;
    const toggleRequestId = activeToggleRequestRef.current;
    const toggleEpoch = localMutationEpochRef.current;
    const previous = escalated;
    const optimistic = !previous;
    setEscalated(optimistic);
    try {
      const actual = await toggleEscalation(incidentId);
      if (localMutationEpochRef.current !== toggleEpoch) {
        // Stale completion — a newer incident/toggle bumped the epoch while
        // this call was in flight. Surface at debug level so a real Firestore
        // error arriving late is still observable in devtools, even though
        // we intentionally do not touch UI state for the stale epoch.
        console.debug(
          '[useEscalation] Ignoring stale toggle success for previous epoch',
          { toggleEpoch, currentEpoch: localMutationEpochRef.current },
        );
        return;
      }
      if (actual !== optimistic) setEscalated(actual);
    } catch (err) {
      if (localMutationEpochRef.current !== toggleEpoch) {
        // Same stale-epoch guard as the success path, but the error is worth
        // keeping visible in production logs — a late Firestore rejection
        // can still indicate a race or intermittent write failure. We
        // deliberately do NOT call setToggleError because the UI has moved
        // on to a new incident.
        console.warn(
          '[useEscalation] Ignoring stale toggle failure for previous epoch',
          { toggleEpoch, currentEpoch: localMutationEpochRef.current, err },
        );
        return;
      }
      setEscalated(previous);
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setToggleError(wrapped);
      console.error('[useEscalation] Toggle failed:', wrapped);
    } finally {
      // Release the guard AND clear `isToggling` only when this call is
      // still the latest request. If the incident changed mid-flight, the
      // effect bumped `activeToggleRequestRef`; the new incident may have
      // already issued its own toggle (which flipped `toggleInFlightRef`
      // back to true via the fresh call). A stale completion clearing the
      // ref here would unblock a second concurrent toggle for the new
      // incident — the exact race this guard exists to prevent. Same
      // argument applies to `setIsToggling(false)`: clearing it would
      // clobber the pending state of the newer request.
      if (activeToggleRequestRef.current === toggleRequestId) {
        toggleInFlightRef.current = false;
        setIsToggling(false);
      }
    }
  };

  return { escalated, isToggling, toggleError, toggle };
}

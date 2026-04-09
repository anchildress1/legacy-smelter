import { useState, useEffect } from 'react';
import { toggleEscalation, hasEscalated, syncEscalationState } from '../services/escalationService';

export interface UseEscalationResult {
  readonly escalated: boolean;
  readonly isToggling: boolean;
  readonly error: string | null;
  readonly toggle: () => Promise<void>;
  readonly clearError: () => void;
}

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

  return { escalated, isToggling, error, toggle, clearError: () => setError(null) };
}

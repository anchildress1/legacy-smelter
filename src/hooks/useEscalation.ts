import { useState, useEffect } from 'react';
import { toggleEscalation, hasEscalated, syncEscalationState } from '../services/escalationService';

export function useEscalation(incidentId: string | null) {
  const [escalated, setEscalated] = useState(() => incidentId ? hasEscalated(incidentId) : false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    if (!incidentId) {
      setEscalated(false);
      return;
    }
    setEscalated(hasEscalated(incidentId));
    let cancelled = false;
    syncEscalationState(incidentId)
      .then((state) => { if (!cancelled) setEscalated(state); })
      .catch((err) => { console.error('[useEscalation] syncEscalationState failed:', err); });
    return () => { cancelled = true; };
  }, [incidentId]);

  const toggle = async () => {
    if (!incidentId || isToggling) return;
    setIsToggling(true);
    const wasEscalated = escalated;
    setEscalated(!wasEscalated);
    try {
      const newState = await toggleEscalation(incidentId);
      if (newState === wasEscalated) setEscalated(wasEscalated);
    } catch (err) {
      setEscalated(wasEscalated);
      console.error('[useEscalation] Toggle failed:', err);
    } finally {
      setIsToggling(false);
    }
  };

  return { escalated, isToggling, toggle } as const;
}

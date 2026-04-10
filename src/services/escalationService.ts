import { db, ensureAnonymousAuth, doc, runTransaction, increment, getDoc, serverTimestamp } from '../firebase';
import { getAuth } from 'firebase/auth';
import { IMPACT_WEIGHTS } from '../types';
import { safeParseJsonFromStorage } from '../lib/storageJson';

const STORAGE_KEY = 'escalated_incidents';
const LOG_PREFIX = '[escalationService]';
const inFlightEscalations = new Set<string>();
const ESCALATION_STATE_EVENT = 'legacy-smelter:escalation-state-changed';

interface EscalationStateChangeDetail {
  incidentId: string;
  escalated: boolean;
}

function emitEscalationStateChange(detail: EscalationStateChangeDetail): void {
  if (typeof globalThis.window === 'undefined') return;
  globalThis.window.dispatchEvent(new CustomEvent<EscalationStateChangeDetail>(ESCALATION_STATE_EVENT, { detail }));
}

function getEscalatedSet(): Set<string> {
  return safeParseJsonFromStorage(
    STORAGE_KEY,
    LOG_PREFIX,
    (parsed) => {
      if (!Array.isArray(parsed) || !parsed.every((v): v is string => typeof v === 'string')) {
        return null;
      }
      return new Set(parsed);
    },
    new Set<string>(),
  );
}

function persistEscalatedSet(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch (err) {
    // Cache persistence is best-effort; Firestore is the source of truth.
    console.error(`${LOG_PREFIX} localStorage write failed:`, err);
  }
}

export function hasEscalated(incidentId: string): boolean {
  return getEscalatedSet().has(incidentId);
}

export function subscribeEscalationStateChange(
  listener: (detail: EscalationStateChangeDetail) => void,
): () => void {
  if (typeof globalThis.window === 'undefined') return () => {};
  const onChange = (event: Event) => {
    const custom = event as CustomEvent<EscalationStateChangeDetail>;
    if (!custom.detail) return;
    listener(custom.detail);
  };
  globalThis.window.addEventListener(ESCALATION_STATE_EVENT, onChange as EventListener);
  return () => {
    globalThis.window.removeEventListener(ESCALATION_STATE_EVENT, onChange as EventListener);
  };
}

/**
 * Toggles the current user's escalation on an incident.
 * Uses a Firestore transaction to read the escalation subcollection doc
 * before deciding whether to create or delete.
 *
 * Concurrency: in-flight calls for the same incident are deduped and
 * return the current cached state.
 *
 * Failure handling: errors are thrown to the caller. The caller is
 * responsible for rolling back any optimistic UI and surfacing feedback.
 *
 * Returns the new escalation state (true = escalated, false = de-escalated).
 */
export async function toggleEscalation(incidentId: string): Promise<boolean> {
  if (inFlightEscalations.has(incidentId)) return hasEscalated(incidentId);

  inFlightEscalations.add(incidentId);
  try {
    await ensureAnonymousAuth();
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');

    const incidentRef = doc(db, 'incident_logs', incidentId);
    const escalationRef = doc(db, 'incident_logs', incidentId, 'escalations', uid);

    const newState = await runTransaction(db, async (tx) => {
      const escalationSnap = await tx.get(escalationRef);

      if (escalationSnap.exists()) {
        tx.delete(escalationRef);
        tx.update(incidentRef, {
          escalation_count: increment(-1),
          impact_score: increment(-IMPACT_WEIGHTS.escalation),
        });
        return false;
      } else {
        tx.set(escalationRef, { uid, timestamp: serverTimestamp() });
        tx.update(incidentRef, {
          escalation_count: increment(1),
          impact_score: increment(IMPACT_WEIGHTS.escalation),
        });
        return true;
      }
    });

    const set = getEscalatedSet();
    if (newState) {
      set.add(incidentId);
    } else {
      set.delete(incidentId);
    }
    persistEscalatedSet(set);
    emitEscalationStateChange({ incidentId, escalated: newState });

    return newState;
  } finally {
    inFlightEscalations.delete(incidentId);
  }
}

/**
 * Reads the authoritative escalation state for the current user from Firestore
 * and updates localStorage to match. Throws on any read failure so callers can
 * surface the problem to the user instead of silently drifting.
 */
export async function syncEscalationState(incidentId: string): Promise<boolean> {
  await ensureAnonymousAuth();
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('No authenticated user');

  const escalationRef = doc(db, 'incident_logs', incidentId, 'escalations', uid);
  const snap = await getDoc(escalationRef);
  const exists = snap.exists();

  const set = getEscalatedSet();
  if (exists) {
    set.add(incidentId);
  } else {
    set.delete(incidentId);
  }
  persistEscalatedSet(set);
  return exists;
}

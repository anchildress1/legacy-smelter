import { db, ensureAnonymousAuth, doc, runTransaction, increment, getDoc, serverTimestamp } from '../firebase';
import { getAuth } from 'firebase/auth';

const STORAGE_KEY = 'escalated_incidents';
const inFlightEscalations = new Set<string>();

function getEscalatedSet(): Set<string> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error('[escalationService] localStorage read failed:', err);
    return new Set();
  }
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((v): v is string => typeof v === 'string')) {
      console.error('[escalationService] Corrupted escalations storage; clearing.');
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (removeErr) {
        console.error('[escalationService] Failed to clear corrupted storage:', removeErr);
      }
      return new Set();
    }
    return new Set(parsed);
  } catch (err) {
    console.error('[escalationService] Failed to parse escalations; clearing.', err);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (removeErr) {
      console.error('[escalationService] Failed to clear invalid storage:', removeErr);
    }
    return new Set();
  }
}

function persistEscalatedSet(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch (err) {
    // Cache persistence is best-effort; Firestore is the source of truth.
    console.error('[escalationService] localStorage write failed:', err);
  }
}

export function hasEscalated(incidentId: string): boolean {
  return getEscalatedSet().has(incidentId);
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
          impact_score: increment(-3),
        });
        return false;
      } else {
        tx.set(escalationRef, { uid, timestamp: serverTimestamp() });
        tx.update(incidentRef, {
          escalation_count: increment(1),
          impact_score: increment(3),
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

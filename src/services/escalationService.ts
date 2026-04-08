import { doc, runTransaction, increment, getDoc } from '../firebase';
import { db, ensureAnonymousAuth } from '../firebase';
import { getAuth } from 'firebase/auth';

const STORAGE_KEY = 'escalated_incidents';
const inFlightEscalations = new Set<string>();

function getEscalatedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (err) {
    console.warn('[escalationService] Failed to parse localStorage escalations:', err);
    return new Set();
  }
}

function persistEscalatedSet(set: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export function hasEscalated(incidentId: string): boolean {
  return getEscalatedSet().has(incidentId);
}

/**
 * Toggles the current user's escalation on an incident.
 * Uses a Firestore transaction to read the escalation subcollection doc
 * before deciding whether to create or delete — this eliminates drift
 * between localStorage and Firestore that caused silent batch failures
 * when batch.set hit a missing `update` rule on an existing doc.
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
        tx.update(incidentRef, { escalation_count: increment(-1) });
        return false;
      } else {
        tx.set(escalationRef, { uid, timestamp: new Date() });
        tx.update(incidentRef, { escalation_count: increment(1) });
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
  } catch (err) {
    console.error('[escalationService] Toggle failed, re-syncing:', err);
    return syncEscalationState(incidentId);
  } finally {
    inFlightEscalations.delete(incidentId);
  }
}

/**
 * Syncs localStorage with Firestore for a specific incident.
 * Call this once per visible card to correct any drift.
 */
export async function syncEscalationState(incidentId: string): Promise<boolean> {
  try {
    await ensureAnonymousAuth();
    const uid = getAuth().currentUser?.uid;
    if (!uid) return false;

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
  } catch (err) {
    console.error('[escalationService] syncEscalationState failed for', incidentId, err);
    return hasEscalated(incidentId);
  }
}

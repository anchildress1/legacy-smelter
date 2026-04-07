import { doc, writeBatch, increment, getDoc } from '../firebase';
import { db, ensureAnonymousAuth } from '../firebase';
import { getAuth } from 'firebase/auth';

const STORAGE_KEY = 'escalated_incidents';
const inFlightEscalations = new Set<string>();

function getEscalatedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
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
 * Uses a batch write to atomically update the subcollection doc
 * and the parent doc's escalation_count.
 *
 * If the batch fails (e.g. localStorage drifted from Firestore),
 * re-syncs with Firestore and returns the corrected state.
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
    const alreadyEscalated = hasEscalated(incidentId);

    const batch = writeBatch(db);

    if (alreadyEscalated) {
      batch.delete(escalationRef);
      batch.update(incidentRef, { escalation_count: increment(-1) });
    } else {
      batch.set(escalationRef, { uid, timestamp: new Date() });
      batch.update(incidentRef, { escalation_count: increment(1) });
    }

    await batch.commit();

    const set = getEscalatedSet();
    if (alreadyEscalated) {
      set.delete(incidentId);
    } else {
      set.add(incidentId);
    }
    persistEscalatedSet(set);

    return !alreadyEscalated;
  } catch (err) {
    console.error('[escalationService] Toggle failed, re-syncing:', err);
    // Batch failed — localStorage likely drifted from Firestore.
    // Re-sync to get the authoritative state.
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
  } catch {
    return hasEscalated(incidentId);
  }
}

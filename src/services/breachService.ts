import { doc, updateDoc, increment } from 'firebase/firestore';
import { db, ensureAnonymousAuth } from '../firebase';

const COOLDOWN_MS = 7_000;
const lastBreach = new Map<string, number>();
const inFlightBreaches = new Set<string>();

/**
 * Increments breach_count on an incident doc.
 * 7-second cooldown prevents accidental double-clicks.
 * Cooldown only applies after a successful write.
 */
export async function recordBreach(incidentId: string): Promise<void> {
  const now = Date.now();
  const last = lastBreach.get(incidentId);
  if (last && now - last < COOLDOWN_MS) return;
  if (inFlightBreaches.has(incidentId)) return;

  inFlightBreaches.add(incidentId);
  try {
    await ensureAnonymousAuth();
    await updateDoc(doc(db, 'incident_logs', incidentId), {
      breach_count: increment(1),
    });
    lastBreach.set(incidentId, Date.now());
  } catch (err) {
    console.error('[breachService] Increment failed:', err);
  } finally {
    inFlightBreaches.delete(incidentId);
  }
}

import { doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../firebase';

const COOLDOWN_MS = 7_000;
const lastBreach = new Map<string, number>();

/**
 * Increments breach_count on an incident doc.
 * Client-side cooldown prevents rapid-fire clicks.
 */
export async function recordBreach(incidentId: string): Promise<void> {
  const now = Date.now();
  const last = lastBreach.get(incidentId);
  if (last && now - last < COOLDOWN_MS) return;

  lastBreach.set(incidentId, now);
  try {
    await updateDoc(doc(db, 'incident_logs', incidentId), {
      breach_count: increment(1),
    });
  } catch (err) {
    console.error('[breachService] Increment failed:', err);
  }
}

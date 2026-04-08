import { doc, updateDoc, increment } from '../firebase';
import { db, ensureAnonymousAuth } from '../firebase';

const COOLDOWN_MS = 7_000;
const STORAGE_KEY = 'breach_cooldowns';
const inFlightBreaches = new Set<string>();

function getCooldowns(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (err) {
    console.warn('[breachService] Failed to parse localStorage cooldowns:', err);
    return {};
  }
}

function isOnCooldown(incidentId: string): boolean {
  const last = getCooldowns()[incidentId];
  return !!last && Date.now() - last < COOLDOWN_MS;
}

function setCooldown(incidentId: string): void {
  const cooldowns = getCooldowns();
  const now = Date.now();
  // Prune expired entries to prevent unbounded growth
  for (const key of Object.keys(cooldowns)) {
    if (now - cooldowns[key] >= COOLDOWN_MS) delete cooldowns[key];
  }
  cooldowns[incidentId] = now;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cooldowns));
}

/**
 * Increments breach_count on an incident doc.
 * 7-second per-user-per-card cooldown (persisted in localStorage)
 * prevents rapid-fire increments from double-clicks, tab duplication,
 * or page refreshes.
 */
export async function recordBreach(incidentId: string): Promise<void> {
  if (isOnCooldown(incidentId)) return;
  if (inFlightBreaches.has(incidentId)) return;

  inFlightBreaches.add(incidentId);
  try {
    await ensureAnonymousAuth();
    await updateDoc(doc(db, 'incident_logs', incidentId), {
      breach_count: increment(1),
    });
    setCooldown(incidentId);
  } catch (err) {
    console.error('[breachService] Increment failed:', err);
  } finally {
    inFlightBreaches.delete(incidentId);
  }
}

import { db, ensureAnonymousAuth, doc, updateDoc, increment } from '../firebase';

const COOLDOWN_MS = 7_000;
const STORAGE_KEY = 'breach_cooldowns';
const inFlightBreaches = new Set<string>();

function getCooldowns(): Record<string, number> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error('[breachService] localStorage read failed:', err);
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error('[breachService] Corrupted cooldowns storage; clearing.');
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (removeErr) {
        console.error('[breachService] Failed to clear corrupted cooldowns storage:', removeErr);
      }
      return {};
    }
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    }
    return result;
  } catch (err) {
    console.error('[breachService] Failed to parse cooldowns; clearing.', err);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (removeErr) {
      console.error('[breachService] Failed to clear invalid cooldowns storage:', removeErr);
    }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cooldowns));
  } catch (err) {
    // Cooldown persistence is best-effort; write success has already happened.
    console.error('[breachService] localStorage write failed:', err);
  }
}

export interface BreachResult {
  readonly ok: boolean;
  readonly skipped?: 'cooldown' | 'in_flight';
  readonly error?: string;
}

/**
 * Increments breach_count on an incident doc. The counter feeds the Impact
 * score (2× weight) and the P0 feed sort — this is product state, not
 * analytics.
 *
 * Concurrency: in-flight calls for the same incident are deduped and rapid
 * repeats are rate-limited by a 7-second per-browser cooldown keyed on
 * incidentId (persisted in localStorage; note this is per-browser, not
 * per-user — a shared device cannot distinguish identities).
 *
 * Failure handling: returns a structured result. Cooldown is only recorded
 * on success so failed calls can be retried immediately. Callers should
 * surface errors visibly rather than assuming success.
 */
export async function recordBreach(incidentId: string): Promise<BreachResult> {
  if (isOnCooldown(incidentId)) return { ok: false, skipped: 'cooldown' };
  if (inFlightBreaches.has(incidentId)) return { ok: false, skipped: 'in_flight' };

  inFlightBreaches.add(incidentId);
  try {
    await ensureAnonymousAuth();
    await updateDoc(doc(db, 'incident_logs', incidentId), {
      breach_count: increment(1),
      impact_score: increment(2),
    });
    setCooldown(incidentId);
    return { ok: true };
  } catch (err) {
    console.error('[breachService] Increment failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    inFlightBreaches.delete(incidentId);
  }
}

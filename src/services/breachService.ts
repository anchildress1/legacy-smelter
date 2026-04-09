import { db, ensureAnonymousAuth, doc, updateDoc, increment } from '../firebase';
import { IMPACT_WEIGHTS } from '../types';
import { safeParseJsonFromStorage } from '../lib/storageJson';
import { isObject, isFiniteNumber } from '../lib/typeGuards';

const COOLDOWN_MS = 7_000;
const STORAGE_KEY = 'breach_cooldowns';
const LOG_PREFIX = '[breachService]';
const inFlightBreaches = new Set<string>();

function getCooldowns(): Record<string, number> {
  return safeParseJsonFromStorage(
    STORAGE_KEY,
    LOG_PREFIX,
    (parsed) => {
      if (!isObject(parsed) || Array.isArray(parsed)) return null;
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (isFiniteNumber(value)) result[key] = value;
      }
      return result;
    },
    {},
  );
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
    console.error(`${LOG_PREFIX} localStorage write failed:`, err);
  }
}

/**
 * Outcome of a `recordBreach` call.
 *
 * - `ok: true` — the Firestore increment succeeded and the cooldown is now
 *   set. The caller should render success state.
 * - `ok: false` with `skipped: 'cooldown'` — the user hit the breach button
 *   within COOLDOWN_MS of their previous successful hit. No-op; retryable
 *   after the cooldown expires. This is NOT an error.
 * - `ok: false` with `skipped: 'in_flight'` — another breach for this same
 *   incident is already mid-request in the same tab. No-op; the user does
 *   not need to be told.
 * - `ok: false` with `error` set — the Firestore write actually failed and
 *   the caller MUST surface it. `error` is the underlying error message.
 */
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
      impact_score: increment(IMPACT_WEIGHTS.breach),
    });
    setCooldown(incidentId);
    return { ok: true };
  } catch (err) {
    console.error(`${LOG_PREFIX} Increment failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    inFlightBreaches.delete(incidentId);
  }
}

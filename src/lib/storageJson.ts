/**
 * Shared helper for reading JSON-encoded state from localStorage safely.
 *
 * Both the breach cooldown map and the escalation id set are persisted as
 * JSON in localStorage to survive reloads without hitting Firestore. Both
 * used to re-implement the same defensive pattern: guard against
 * `localStorage.getItem` throwing, guard against `JSON.parse` throwing,
 * validate the shape, and clear-on-corrupt so bad state doesn't trap the
 * user forever.
 *
 * This helper consolidates that logic. The caller supplies a shape guard
 * and an empty value; on any read/parse/shape failure the key is
 * best-effort removed and the empty value is returned.
 */
export function safeParseJsonFromStorage<T>(
  storageKey: string,
  logPrefix: string,
  validate: (parsed: unknown) => T | null,
  empty: T,
): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch (err) {
    console.error(`${logPrefix} localStorage read failed:`, err);
    return empty;
  }
  if (raw === null) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`${logPrefix} Failed to parse storage; clearing.`, err);
    clearStorage(storageKey, logPrefix);
    return empty;
  }

  const validated = validate(parsed);
  if (validated === null) {
    console.error(`${logPrefix} Corrupted storage; clearing.`);
    clearStorage(storageKey, logPrefix);
    return empty;
  }
  return validated;
}

function clearStorage(storageKey: string, logPrefix: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch (removeErr) {
    console.error(`${logPrefix} Failed to clear storage:`, removeErr);
  }
}

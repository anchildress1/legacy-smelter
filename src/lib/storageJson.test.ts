import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeParseJsonFromStorage } from './storageJson';

/**
 * Shared helper for both the breach cooldown map and the escalation id
 * set. Both callers depend on the clear-on-corrupt and return-empty
 * contracts — if a broken JSON payload survived in storage it would
 * trap the user in a permanent error state, so these tests pin the
 * recovery branches explicitly.
 */

const KEY = 'test_storage_key';
const EMPTY: number[] = [];

function alwaysValid(parsed: unknown): number[] | null {
  return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : null;
}

describe('safeParseJsonFromStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the empty value when the key is absent', () => {
    const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, EMPTY);
    expect(result).toBe(EMPTY);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('parses and returns valid JSON via the shape validator', () => {
    localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));
    const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, EMPTY);
    expect(result).toEqual([1, 2, 3]);
  });

  it('drops non-number entries via the validator without clearing storage', () => {
    // When the validator returns a non-null value, the helper treats it
    // as a successful parse — storage is kept as-is.
    localStorage.setItem(KEY, JSON.stringify([1, 'two', 3]));
    const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, EMPTY);
    expect(result).toEqual([1, 3]);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('clears storage and returns empty when JSON.parse throws', () => {
    localStorage.setItem(KEY, '{not valid json');
    const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, EMPTY);
    expect(result).toBe(EMPTY);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      '[test] Failed to parse storage; clearing.',
      expect.any(Error),
    );
  });

  it('clears storage and returns empty when the validator rejects the shape', () => {
    localStorage.setItem(KEY, JSON.stringify({ not: 'an-array' }));
    const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, EMPTY);
    expect(result).toBe(EMPTY);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(console.error).toHaveBeenCalledWith('[test] Corrupted storage; clearing.');
  });

  it('returns empty without throwing when localStorage.getItem throws', () => {
    // Simulates quota-denied private modes that throw on any access.
    // `src/test/setup.ts` swaps in a plain-object storage fake, so the
    // override goes on the instance instead of `Storage.prototype`.
    const originalGetItem = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => {
      throw new Error('storage disabled');
    };
    try {
      const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, EMPTY);
      expect(result).toBe(EMPTY);
      expect(console.error).toHaveBeenCalledWith(
        '[test] localStorage read failed:',
        expect.any(Error),
      );
    } finally {
      localStorage.getItem = originalGetItem;
    }
  });

  it('logs but does not throw when clearStorage also fails', () => {
    // Clear-on-corrupt has a fallback: the best-effort `removeItem` can
    // itself throw in hardened environments. The helper must still
    // return the empty value — the user must not be stuck in a loop.
    localStorage.setItem(KEY, '{invalid json');
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = () => {
      throw new Error('remove disabled');
    };
    try {
      const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, EMPTY);
      expect(result).toBe(EMPTY);
      // Two error logs: parse failure + clear failure.
      expect(console.error).toHaveBeenCalledWith(
        '[test] Failed to parse storage; clearing.',
        expect.any(Error),
      );
      expect(console.error).toHaveBeenCalledWith(
        '[test] Failed to clear storage:',
        expect.any(Error),
      );
    } finally {
      localStorage.removeItem = originalRemoveItem;
    }
  });

  it('returns the empty value pristine (does not mutate it on validate failure)', () => {
    localStorage.setItem(KEY, 'garbage');
    const empty: number[] = [];
    const result = safeParseJsonFromStorage(KEY, '[test]', alwaysValid, empty);
    expect(result).toBe(empty);
    expect(empty).toEqual([]);
  });
});

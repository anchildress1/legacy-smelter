import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsureAnonymousAuth = vi.fn<() => Promise<void>>();
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const mockUpdateDoc = vi.fn();
const mockIncrement = vi.fn((by: number) => ({ __op: 'increment', by }));

vi.mock('../firebase', () => ({
  db: { __db: true },
  ensureAnonymousAuth: mockEnsureAnonymousAuth,
  doc: mockDoc,
  updateDoc: mockUpdateDoc,
  increment: mockIncrement,
}));

type BreachServiceModule = typeof import('./breachService');

async function loadService(): Promise<BreachServiceModule> {
  return import('./breachService');
}

describe('breachService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    mockEnsureAnonymousAuth.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  it('skips breach writes while cooldown window is active', async () => {
    localStorage.setItem('breach_cooldowns', JSON.stringify({ 'inc-1': 999_500 }));
    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-1')).resolves.toEqual({ ok: false, skipped: 'cooldown' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('dedupes in-flight breaches per incident', async () => {
    let finish!: () => void;
    mockUpdateDoc.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const { recordBreach } = await loadService();

    const first = recordBreach('inc-2');
    const second = recordBreach('inc-2');

    await expect(second).resolves.toEqual({ ok: false, skipped: 'in_flight' });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);

    finish();
    await expect(first).resolves.toEqual({ ok: true });
  });

  it('writes paired breach_count and impact_score increments and stores cooldown', async () => {
    localStorage.setItem('breach_cooldowns', JSON.stringify({ stale: 990_000, fresh: 999_000 }));

    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-3')).resolves.toEqual({ ok: true });

    expect(mockDoc).toHaveBeenCalledWith({ __db: true }, 'incident_logs', 'inc-3');
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'incident_logs/inc-3' },
      {
        breach_count: { __op: 'increment', by: 1 },
        impact_score: { __op: 'increment', by: 2 },
      },
    );

    expect(JSON.parse(localStorage.getItem('breach_cooldowns') ?? '{}')).toEqual({
      fresh: 999_000,
      'inc-3': 1_000_000,
    });
  });

  it('returns error details and does not set cooldown when write fails', async () => {
    mockUpdateDoc.mockRejectedValue(new Error('write failed'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-4')).resolves.toEqual({ ok: false, error: 'write failed' });
    expect(localStorage.getItem('breach_cooldowns')).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('normalizes non-Error throwables to strings in error result', async () => {
    mockUpdateDoc.mockRejectedValue('kaboom');

    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-5')).resolves.toEqual({ ok: false, error: 'kaboom' });
  });

  it('returns error when auth bootstrap fails', async () => {
    mockEnsureAnonymousAuth.mockRejectedValue(new Error('auth down'));

    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-6')).resolves.toEqual({ ok: false, error: 'auth down' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('returns success even if cooldown persistence fails after write', async () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-7')).resolves.toEqual({ ok: true });
    expect(setItemSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('treats a cooldown entry exactly COOLDOWN_MS old as expired', async () => {
    // Boundary case: the check is `Date.now() - last < COOLDOWN_MS` (strict
    // less-than), so an entry exactly 7000ms old must be treated as expired
    // and the new write must go through. Pinning this keeps a future
    // refactor from silently flipping the comparator to `<=`.
    localStorage.setItem('breach_cooldowns', JSON.stringify({ 'inc-boundary': 993_000 }));
    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-boundary')).resolves.toEqual({ ok: true });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('allows a follow-up breach on the same incident after the in-flight call completes and cooldown expires', async () => {
    // The in-flight dedup guard must release after the first call finishes,
    // and the follow-up call (once past the cooldown window) must proceed
    // normally. A regression that leaked the in-flight entry would block
    // every subsequent breach for this incident for the rest of the
    // session.
    const { recordBreach } = await loadService();

    await expect(recordBreach('inc-retry')).resolves.toEqual({ ok: true });

    // Advance clock past the cooldown window so the follow-up is not
    // short-circuited by the cooldown gate.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 8_000);

    await expect(recordBreach('inc-retry')).resolves.toEqual({ ok: true });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(2);
  });
});

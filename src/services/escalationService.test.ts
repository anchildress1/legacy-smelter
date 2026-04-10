import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsureAnonymousAuth = vi.fn<() => Promise<void>>();
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const mockRunTransaction = vi.fn();
const mockIncrement = vi.fn((by: number) => ({ __op: 'increment', by }));
const mockGetDoc = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ __op: 'serverTimestamp' }));

const mockGetAuth = vi.fn<() => { currentUser: { uid: string } | null }>(() => ({
  currentUser: { uid: 'user-1' },
}));

vi.mock('../firebase', () => ({
  db: { __db: true },
  ensureAnonymousAuth: mockEnsureAnonymousAuth,
  doc: mockDoc,
  runTransaction: mockRunTransaction,
  increment: mockIncrement,
  getDoc: mockGetDoc,
  serverTimestamp: mockServerTimestamp,
}));

vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
}));

type EscalationServiceModule = typeof import('./escalationService');

async function loadService(): Promise<EscalationServiceModule> {
  return import('./escalationService');
}

describe('escalationService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    mockGetAuth.mockReturnValue({ currentUser: { uid: 'user-1' } });
    mockEnsureAnonymousAuth.mockResolvedValue(undefined);
  });

  it('returns false and clears storage when cached escalation state is corrupt JSON', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('escalated_incidents', '{nope');

    const { hasEscalated } = await loadService();

    expect(hasEscalated('inc-1')).toBe(false);
    expect(localStorage.getItem('escalated_incidents')).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('subscribes and unsubscribes escalation state events', async () => {
    const { subscribeEscalationStateChange } = await loadService();

    const listener = vi.fn();
    const unsubscribe = subscribeEscalationStateChange(listener);

    window.dispatchEvent(
      new CustomEvent('legacy-smelter:escalation-state-changed', {
        detail: { incidentId: 'inc-1', escalated: true },
      }),
    );

    expect(listener).toHaveBeenCalledWith({ incidentId: 'inc-1', escalated: true });

    unsubscribe();

    window.dispatchEvent(
      new CustomEvent('legacy-smelter:escalation-state-changed', {
        detail: { incidentId: 'inc-1', escalated: false },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('creates escalation when absent, updates impact pair, persists local cache, and emits event', async () => {
    const tx = {
      get: vi.fn().mockResolvedValue({ exists: () => false }),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (txArg: unknown) => unknown) => fn(tx));

    const { toggleEscalation, subscribeEscalationStateChange } = await loadService();
    const listener = vi.fn();
    const unsubscribe = subscribeEscalationStateChange(listener);

    await expect(toggleEscalation('inc-1')).resolves.toBe(true);

    expect(tx.set).toHaveBeenCalledWith(
      { path: 'incident_logs/inc-1/escalations/user-1' },
      { uid: 'user-1', timestamp: { __op: 'serverTimestamp' } },
    );
    expect(tx.update).toHaveBeenCalledWith(
      { path: 'incident_logs/inc-1' },
      {
        escalation_count: { __op: 'increment', by: 1 },
        impact_score: { __op: 'increment', by: 3 },
      },
    );
    expect(JSON.parse(localStorage.getItem('escalated_incidents') ?? '[]')).toEqual(['inc-1']);
    expect(listener).toHaveBeenCalledWith({ incidentId: 'inc-1', escalated: true });

    unsubscribe();
  });

  it('removes escalation when already present and decrements paired impact', async () => {
    localStorage.setItem('escalated_incidents', JSON.stringify(['inc-1']));

    const tx = {
      get: vi.fn().mockResolvedValue({ exists: () => true }),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (txArg: unknown) => unknown) => fn(tx));

    const { toggleEscalation } = await loadService();

    await expect(toggleEscalation('inc-1')).resolves.toBe(false);

    expect(tx.delete).toHaveBeenCalledWith({ path: 'incident_logs/inc-1/escalations/user-1' });
    expect(tx.update).toHaveBeenCalledWith(
      { path: 'incident_logs/inc-1' },
      {
        escalation_count: { __op: 'increment', by: -1 },
        impact_score: { __op: 'increment', by: -3 },
      },
    );
    expect(JSON.parse(localStorage.getItem('escalated_incidents') ?? '[]')).toEqual([]);
  });

  it('dedupes concurrent toggle requests per incident and returns cached state for duplicate calls', async () => {
    localStorage.setItem('escalated_incidents', JSON.stringify(['inc-1']));

    let finishTransaction!: (value: boolean) => void;
    mockRunTransaction.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishTransaction = resolve;
        }),
    );

    const { toggleEscalation } = await loadService();

    const first = toggleEscalation('inc-1');
    const second = toggleEscalation('inc-1');

    await expect(second).resolves.toBe(true);
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);

    finishTransaction(true);
    await expect(first).resolves.toBe(true);
  });

  it('throws when auth has no uid', async () => {
    mockGetAuth.mockReturnValue({ currentUser: null });
    const { toggleEscalation } = await loadService();

    await expect(toggleEscalation('inc-1')).rejects.toThrow('No authenticated user');
  });

  it('syncEscalationState writes true into local cache when escalation doc exists', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true });

    const { syncEscalationState, hasEscalated } = await loadService();

    await expect(syncEscalationState('inc-2')).resolves.toBe(true);
    expect(hasEscalated('inc-2')).toBe(true);
  });

  it('syncEscalationState clears local cache when escalation doc does not exist', async () => {
    localStorage.setItem('escalated_incidents', JSON.stringify(['inc-3']));
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const { syncEscalationState, hasEscalated } = await loadService();

    await expect(syncEscalationState('inc-3')).resolves.toBe(false);
    expect(hasEscalated('inc-3')).toBe(false);
  });

  it('syncEscalationState throws when user is unauthenticated', async () => {
    mockGetAuth.mockReturnValue({ currentUser: null });

    const { syncEscalationState } = await loadService();

    await expect(syncEscalationState('inc-4')).rejects.toThrow('No authenticated user');
  });
});

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SnapshotNext = (snap: {
  exists: () => boolean;
  data: () => Record<string, unknown>;
}) => void;
type SnapshotError = (err: Error) => void;

const snapshotHandlers: {
  next: SnapshotNext | null;
  error: SnapshotError | null;
} = { next: null, error: null };
const mockUnsubscribe = vi.fn(() => {
  snapshotHandlers.next = null;
  snapshotHandlers.error = null;
});

vi.mock('../firebase', () => ({
  db: { __db: true },
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })),
  onSnapshot: vi.fn(
    (_ref: unknown, next: SnapshotNext, error?: SnapshotError) => {
      snapshotHandlers.next = next;
      snapshotHandlers.error = error ?? null;
      return mockUnsubscribe;
    },
  ),
}));

async function loadHook() {
  return import('./useGlobalStats');
}

describe('useGlobalStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotHandlers.next = null;
    snapshotHandlers.error = null;
  });

  // ── positive ──

  it('returns zero stats before first snapshot', async () => {
    const { useGlobalStats } = await loadHook();
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    expect(result.current.globalStats).toEqual({ total_pixels_melted: 0 });
    expect(result.current.statsIssue).toBeNull();
  });

  it('updates stats from a valid snapshot', async () => {
    const { useGlobalStats } = await loadHook();
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({ total_pixels_melted: 42_000 }),
      });
    });

    expect(result.current.globalStats).toEqual({ total_pixels_melted: 42_000 });
    expect(result.current.statsIssue).toBeNull();
  });

  it('clears a previous schema issue when a valid snapshot arrives', async () => {
    const { useGlobalStats } = await loadHook();
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({ total_pixels_melted: 'bad' }),
      });
    });
    expect(result.current.statsIssue).not.toBeNull();

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({ total_pixels_melted: 100 }),
      });
    });
    expect(result.current.statsIssue).toBeNull();
    expect(result.current.globalStats.total_pixels_melted).toBe(100);
  });

  // ── negative ──

  it('ignores a snapshot where the document does not exist', async () => {
    const { useGlobalStats } = await loadHook();
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => false,
        data: () => ({}),
      });
    });

    expect(result.current.globalStats).toEqual({ total_pixels_melted: 0 });
    expect(result.current.statsIssue).toBeNull();
  });

  it.each([
    ['a string', 'not a number'],
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
  ] as const)('sets statsIssue when total_pixels_melted is %s', async (_label, badValue) => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useGlobalStats, DEFAULT_STATS_SCHEMA_ISSUE } = await loadHook();
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({ total_pixels_melted: badValue }),
      });
    });

    expect(result.current.statsIssue).toBe(DEFAULT_STATS_SCHEMA_ISSUE);
    consoleErrorSpy.mockRestore();
  });

  it('uses custom schemaIssueCopy when provided', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useGlobalStats } = await loadHook();
    const customCopy = 'CUSTOM SCHEMA ERROR.';
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test', schemaIssueCopy: customCopy }),
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({ total_pixels_melted: null }),
      });
    });

    expect(result.current.statsIssue).toBe(customCopy);
    consoleErrorSpy.mockRestore();
  });

  // ── error ──

  it('surfaces a Firestore subscription error via statsIssue', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useGlobalStats } = await loadHook();
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    act(() => {
      snapshotHandlers.error?.(new Error('permission-denied'));
    });

    expect(result.current.statsIssue).toBe(
      'FIRESTORE GET FAILED. DATA MAY BE STALE.',
    );
    consoleErrorSpy.mockRestore();
  });

  // ── edge ──

  it('unsubscribes on unmount', async () => {
    const { useGlobalStats } = await loadHook();
    const { unmount } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('handles total_pixels_melted of zero as valid', async () => {
    const { useGlobalStats } = await loadHook();
    const { result } = renderHook(() =>
      useGlobalStats({ source: 'test' }),
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({ total_pixels_melted: 0 }),
      });
    });

    expect(result.current.globalStats).toEqual({ total_pixels_melted: 0 });
    expect(result.current.statsIssue).toBeNull();
  });
});

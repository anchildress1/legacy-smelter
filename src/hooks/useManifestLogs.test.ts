import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmeltLog } from '../types';

type SnapshotNext = (snap: { docs: unknown[] }) => void;
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
  collection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
  onSnapshot: vi.fn(
    (_query: unknown, next: SnapshotNext, error?: SnapshotError) => {
      snapshotHandlers.next = next;
      snapshotHandlers.error = error ?? null;
      return mockUnsubscribe;
    },
  ),
  query: vi.fn((...args: unknown[]) => ({ __query: true, args })),
  orderBy: vi.fn((field: string, dir: string) => ({ __orderBy: field, dir })),
  limit: vi.fn((n: number) => ({ __limit: n })),
}));

const mockParseSmeltLogBatch = vi.fn<
  (docs: unknown[], opts: { source: string }) => { entries: SmeltLog[]; invalidCount: number }
>();
vi.mock('../lib/smeltLogSchema', () => ({
  parseSmeltLogBatch: (...args: unknown[]) =>
    mockParseSmeltLogBatch(args[0] as unknown[], args[1] as { source: string }),
}));

vi.mock('../lib/firestoreErrors', () => ({
  handleFirestoreError: vi.fn(
    (
      _err: unknown,
      _op: string,
      _path: string,
      onError?: (msg: string) => void,
    ) => {
      onError?.('FIRESTORE LIST FAILED. DATA MAY BE STALE.');
    },
  ),
  OperationType: { LIST: 'list' },
}));

const STUB_LOG: SmeltLog = {
  id: 'inc-1',
  legacy_infra_class: 'TEST',
  diagnosis: 'test',
  chromatic_profile: 'test',
  primary_contamination: 'test',
  contributing_factor: 'test',
  failure_origin: 'test',
  disposition: 'test',
  incident_feed_summary: 'test',
  archive_note: 'test',
  og_headline: 'test',
  share_quote: 'test',
  severity: 'CRITICAL',
  anon_handle: 'Test_1',
  color_1: '#000000',
  color_2: '#111111',
  color_3: '#222222',
  color_4: '#333333',
  color_5: '#444444',
  subject_box_ymin: 0,
  subject_box_xmin: 0,
  subject_box_ymax: 500,
  subject_box_xmax: 500,
  pixel_count: 1000,
  timestamp: { seconds: 1000, nanoseconds: 0 } as SmeltLog['timestamp'],
  uid: 'anon-uid',
  breach_count: 0,
  escalation_count: 0,
  sanction_count: 0,
  sanctioned: false,
  sanction_rationale: null,
  impact_score: 0,
};

async function loadHook() {
  return import('./useManifestLogs');
}

describe('useManifestLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotHandlers.next = null;
    snapshotHandlers.error = null;
    mockParseSmeltLogBatch.mockReturnValue({ entries: [], invalidCount: 0 });
  });

  // ── positive ──

  it('starts in loading state with empty logs', async () => {
    const { useManifestLogs } = await loadHook();
    const { result } = renderHook(() => useManifestLogs('impact'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.allLogs).toEqual([]);
    expect(result.current.manifestIssue).toBeNull();
  });

  it('delivers parsed logs and clears loading after first snapshot', async () => {
    mockParseSmeltLogBatch.mockReturnValue({
      entries: [STUB_LOG],
      invalidCount: 0,
    });
    const { useManifestLogs } = await loadHook();
    const { result } = renderHook(() => useManifestLogs('impact'));

    act(() => {
      snapshotHandlers.next?.({ docs: [{ id: 'inc-1', data: () => ({}) }] });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.allLogs).toEqual([STUB_LOG]);
    expect(result.current.manifestIssue).toBeNull();
  });

  it('re-subscribes when sort mode changes', async () => {
    const { useManifestLogs } = await loadHook();
    type ManifestSortMode = Parameters<typeof useManifestLogs>[0];
    const { rerender } = renderHook(
      ({ mode }: { mode: ManifestSortMode }) => useManifestLogs(mode),
      { initialProps: { mode: 'impact' as ManifestSortMode } },
    );

    expect(mockUnsubscribe).not.toHaveBeenCalled();

    rerender({ mode: 'newest' as ManifestSortMode });

    // The previous subscription should have been cleaned up.
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  // ── negative ──

  it('reports a schema issue when parseSmeltLogBatch returns invalidCount > 0', async () => {
    mockParseSmeltLogBatch.mockReturnValue({
      entries: [STUB_LOG],
      invalidCount: 2,
    });
    const { useManifestLogs, MANIFEST_SCHEMA_ISSUE_PREFIX } = await loadHook();
    const { result } = renderHook(() => useManifestLogs('newest'));

    act(() => {
      snapshotHandlers.next?.({ docs: [{ id: 'inc-1', data: () => ({}) }] });
    });

    expect(result.current.manifestIssue).toContain(MANIFEST_SCHEMA_ISSUE_PREFIX);
    expect(result.current.manifestIssue).toContain('2 incidents');
  });

  it('uses singular noun for a single invalid doc', async () => {
    mockParseSmeltLogBatch.mockReturnValue({
      entries: [],
      invalidCount: 1,
    });
    const { useManifestLogs } = await loadHook();
    const { result } = renderHook(() => useManifestLogs('newest'));

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });

    expect(result.current.manifestIssue).toContain('1 incident');
    expect(result.current.manifestIssue).not.toContain('incidents');
  });

  it('clears a previous schema issue when next snapshot has zero invalid docs', async () => {
    mockParseSmeltLogBatch
      .mockReturnValueOnce({ entries: [], invalidCount: 1 })
      .mockReturnValueOnce({ entries: [STUB_LOG], invalidCount: 0 });

    const { useManifestLogs } = await loadHook();
    const { result } = renderHook(() => useManifestLogs('newest'));

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });
    expect(result.current.manifestIssue).not.toBeNull();

    act(() => {
      snapshotHandlers.next?.({ docs: [{ id: 'inc-1', data: () => ({}) }] });
    });
    expect(result.current.manifestIssue).toBeNull();
  });

  // ── error ──

  it('surfaces a Firestore subscription error, clears logs, and stops loading', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useManifestLogs } = await loadHook();
    const { result } = renderHook(() => useManifestLogs('impact'));

    act(() => {
      snapshotHandlers.error?.(new Error('permission-denied'));
    });

    expect(result.current.manifestIssue).toBe(
      'FIRESTORE LIST FAILED. DATA MAY BE STALE.',
    );
    expect(result.current.allLogs).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  // ── edge ──

  it('unsubscribes on unmount', async () => {
    const { useManifestLogs } = await loadHook();
    const { unmount } = renderHook(() => useManifestLogs('impact'));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('handles empty snapshot (no docs)', async () => {
    mockParseSmeltLogBatch.mockReturnValue({ entries: [], invalidCount: 0 });
    const { useManifestLogs } = await loadHook();
    const { result } = renderHook(() => useManifestLogs('newest'));

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });

    expect(result.current.allLogs).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.manifestIssue).toBeNull();
  });

  it('accepts all four sort modes without error', async () => {
    const { useManifestLogs } = await loadHook();

    for (const mode of ['impact', 'newest', 'breaches', 'escalations'] as const) {
      const { unmount } = renderHook(() => useManifestLogs(mode));
      unmount();
    }
  });
});

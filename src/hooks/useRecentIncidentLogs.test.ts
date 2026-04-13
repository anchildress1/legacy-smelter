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
  return import('./useRecentIncidentLogs');
}

describe('useRecentIncidentLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotHandlers.next = null;
    snapshotHandlers.error = null;
    mockParseSmeltLogBatch.mockReturnValue({ entries: [], invalidCount: 0 });
  });

  // ── positive ──

  it('starts unloaded with empty logs and no issue', async () => {
    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() => useRecentIncidentLogs());

    expect(result.current.loaded).toBe(false);
    expect(result.current.recentLogs).toEqual([]);
    expect(result.current.queueIssue).toBeNull();
  });

  it('delivers parsed logs and marks loaded on first snapshot', async () => {
    mockParseSmeltLogBatch.mockReturnValue({
      entries: [STUB_LOG],
      invalidCount: 0,
    });
    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() => useRecentIncidentLogs());

    act(() => {
      snapshotHandlers.next?.({ docs: [{ id: 'inc-1', data: () => ({}) }] });
    });

    expect(result.current.loaded).toBe(true);
    expect(result.current.recentLogs).toEqual([STUB_LOG]);
    expect(result.current.queueIssue).toBeNull();
  });

  it('accepts a custom limitCount', async () => {
    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() =>
      useRecentIncidentLogs({ limitCount: 5 }),
    );

    expect(result.current.loaded).toBe(false);
  });

  // ── negative ──

  it('sets queueIssue when parseSmeltLogBatch reports invalid docs', async () => {
    mockParseSmeltLogBatch.mockReturnValue({
      entries: [STUB_LOG],
      invalidCount: 3,
    });
    const { useRecentIncidentLogs, DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX } =
      await loadHook();
    const { result } = renderHook(() => useRecentIncidentLogs());

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });

    expect(result.current.queueIssue).toContain(DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX);
    expect(result.current.queueIssue).toContain('3 incidents');
  });

  it('uses singular noun for exactly one invalid doc', async () => {
    mockParseSmeltLogBatch.mockReturnValue({
      entries: [],
      invalidCount: 1,
    });
    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() => useRecentIncidentLogs());

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });

    expect(result.current.queueIssue).toContain('1 incident');
    expect(result.current.queueIssue).not.toContain('incidents');
  });

  it('clears a previous issue when the next snapshot has zero invalid docs', async () => {
    mockParseSmeltLogBatch
      .mockReturnValueOnce({ entries: [], invalidCount: 2 })
      .mockReturnValueOnce({ entries: [STUB_LOG], invalidCount: 0 });

    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() => useRecentIncidentLogs());

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });
    expect(result.current.queueIssue).not.toBeNull();

    act(() => {
      snapshotHandlers.next?.({ docs: [{ id: 'inc-1', data: () => ({}) }] });
    });
    expect(result.current.queueIssue).toBeNull();
  });

  // ── error ──

  it('surfaces a Firestore error and marks loaded so consumers do not hang', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() => useRecentIncidentLogs());

    act(() => {
      snapshotHandlers.error?.(new Error('permission-denied'));
    });

    expect(result.current.queueIssue).toBe(
      'FIRESTORE LIST FAILED. DATA MAY BE STALE.',
    );
    expect(result.current.loaded).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  // ── edge ──

  it('unsubscribes on unmount', async () => {
    const { useRecentIncidentLogs } = await loadHook();
    const { unmount } = renderHook(() => useRecentIncidentLogs());

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('resets loaded to false when limitCount changes', async () => {
    const { useRecentIncidentLogs } = await loadHook();
    const { result, rerender } = renderHook(
      ({ opts }) => useRecentIncidentLogs(opts),
      { initialProps: { opts: { limitCount: 3 } } },
    );

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });
    expect(result.current.loaded).toBe(true);

    rerender({ opts: { limitCount: 5 } });

    expect(result.current.loaded).toBe(false);
  });

  it('handles empty snapshot (no docs in the database)', async () => {
    mockParseSmeltLogBatch.mockReturnValue({ entries: [], invalidCount: 0 });
    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() => useRecentIncidentLogs());

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });

    expect(result.current.recentLogs).toEqual([]);
    expect(result.current.loaded).toBe(true);
    expect(result.current.queueIssue).toBeNull();
  });

  it('uses custom schemaIssuePrefix', async () => {
    mockParseSmeltLogBatch.mockReturnValue({
      entries: [],
      invalidCount: 1,
    });
    const prefix = 'CUSTOM PREFIX.';
    const { useRecentIncidentLogs } = await loadHook();
    const { result } = renderHook(() =>
      useRecentIncidentLogs({ schemaIssuePrefix: prefix }),
    );

    act(() => {
      snapshotHandlers.next?.({ docs: [] });
    });

    expect(result.current.queueIssue).toContain(prefix);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToggleEscalation = vi.fn<(incidentId: string) => Promise<boolean>>();
const mockHasEscalated = vi.fn<(incidentId: string) => boolean>();
const mockSyncEscalationState = vi.fn<(incidentId: string) => Promise<boolean>>();

let activeListener: ((detail: { incidentId: string; escalated: boolean }) => void) | null = null;
const mockSubscribeEscalationStateChange = vi.fn(
  (listener: (detail: { incidentId: string; escalated: boolean }) => void) => {
    activeListener = listener;
    return () => {
      if (activeListener === listener) activeListener = null;
    };
  },
);

vi.mock('../services/escalationService', () => ({
  toggleEscalation: mockToggleEscalation,
  hasEscalated: mockHasEscalated,
  syncEscalationState: mockSyncEscalationState,
  subscribeEscalationStateChange: mockSubscribeEscalationStateChange,
}));

async function loadHook() {
  return import('./useEscalation');
}

describe('useEscalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeListener = null;
    mockHasEscalated.mockReturnValue(false);
    mockSyncEscalationState.mockResolvedValue(false);
    mockToggleEscalation.mockResolvedValue(false);
  });

  it('defaults to false when incident id is null', async () => {
    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation(null));

    expect(result.current.escalated).toBe(false);
    expect(result.current.isToggling).toBe(false);
  });

  it('starts from cached state and then applies authoritative sync result', async () => {
    mockHasEscalated.mockReturnValue(true);
    mockSyncEscalationState.mockResolvedValue(false);
    const { useEscalation } = await loadHook();

    const { result } = renderHook(() => useEscalation('inc-1'));

    expect(result.current.escalated).toBe(true);

    await waitFor(() => {
      expect(result.current.escalated).toBe(false);
    });
  });

  it('applies optimistic toggle and reconciles to server truth when response differs', async () => {
    mockHasEscalated.mockReturnValue(false);
    mockSyncEscalationState.mockResolvedValue(false);
    let resolveToggle!: (value: boolean) => void;
    mockToggleEscalation.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveToggle = resolve;
        }),
    );

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-2'));

    await act(async () => {
      void result.current.toggle();
    });
    await waitFor(() => {
      expect(result.current.escalated).toBe(true);
      expect(result.current.isToggling).toBe(true);
    });

    await act(async () => {
      resolveToggle(false);
      await Promise.resolve();
    });

    expect(result.current.escalated).toBe(false);
    expect(result.current.isToggling).toBe(false);
  });

  it('rolls back optimistic toggle when toggleEscalation throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHasEscalated.mockReturnValue(true);
    mockSyncEscalationState.mockResolvedValue(true);
    mockToggleEscalation.mockRejectedValue(new Error('write failed'));

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-3'));

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.escalated).toBe(true);
    expect(result.current.isToggling).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('ignores stale sync responses when a local toggle happens after sync starts', async () => {
    let resolveSync!: (value: boolean) => void;
    mockHasEscalated.mockReturnValue(false);
    mockSyncEscalationState.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSync = resolve;
        }),
    );
    mockToggleEscalation.mockResolvedValue(true);

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-4'));

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.escalated).toBe(true);

    await act(async () => {
      resolveSync(false);
      await Promise.resolve();
    });

    expect(result.current.escalated).toBe(true);
  });

  it('updates state from subscription events for matching incidents only', async () => {
    mockHasEscalated.mockReturnValue(false);
    mockSyncEscalationState.mockResolvedValue(false);

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-5'));

    act(() => {
      activeListener?.({ incidentId: 'inc-other', escalated: true });
    });
    expect(result.current.escalated).toBe(false);

    act(() => {
      activeListener?.({ incidentId: 'inc-5', escalated: true });
    });
    expect(result.current.escalated).toBe(true);
  });
});

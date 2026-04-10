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

  it('rolls back optimistic toggle when toggleEscalation throws and surfaces the error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHasEscalated.mockReturnValue(true);
    mockSyncEscalationState.mockResolvedValue(true);

    // Block the rejection until the test has observed the optimistic flip,
    // so the test cannot pass if the production hook skips the optimistic
    // update entirely and only rolls back to the pre-toggle state.
    let rejectToggle!: (err: Error) => void;
    mockToggleEscalation.mockImplementation(
      () =>
        new Promise<boolean>((_, reject) => {
          rejectToggle = reject;
        }),
    );

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-3'));

    // Trigger the toggle without awaiting — the promise is still pending
    // so the optimistic state should be observable before rollback.
    await act(async () => {
      void result.current.toggle();
    });
    await waitFor(() => {
      expect(result.current.isToggling).toBe(true);
      expect(result.current.escalated).toBe(false);
    });

    await act(async () => {
      rejectToggle(new Error('write failed'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isToggling).toBe(false);
    });

    expect(result.current.escalated).toBe(true);
    expect(result.current.toggleError).toBeInstanceOf(Error);
    expect(result.current.toggleError?.message).toBe('write failed');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('clears toggleError on a subsequent successful toggle', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHasEscalated.mockReturnValue(true);
    mockSyncEscalationState.mockResolvedValue(true);

    // First call rejects, second resolves. The error should be cleared
    // at the top of the second call so callers re-render without the
    // stale error banner.
    mockToggleEscalation
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(false);

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-clear'));

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.toggleError).toBeInstanceOf(Error);

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.toggleError).toBeNull();
    expect(result.current.escalated).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it('clears toggleError synchronously at the start of the next toggle, before it settles', async () => {
    // The hook contract: `setToggleError(null)` at the top of `toggle`
    // is what de-banners the UI on the next user click. This test pins
    // the *timing* — the null must be observable while `isToggling` is
    // still true, not only after the promise resolves. A regression that
    // delayed the clear until after `toggleEscalation` settled would
    // leave the stale error visible through the entire in-flight window,
    // confusing the user about whether their retry was actually taken.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHasEscalated.mockReturnValue(false);
    mockSyncEscalationState.mockResolvedValue(false);

    mockToggleEscalation.mockRejectedValueOnce(new Error('first fail'));
    let resolveSecond!: (value: boolean) => void;
    mockToggleEscalation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSecond = resolve;
        }),
    );

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-clear-inflight'));

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.toggleError).toBeInstanceOf(Error);

    // Fire the second toggle without settling it — the hook must clear
    // the error and flip isToggling synchronously.
    await act(async () => {
      void result.current.toggle();
    });

    await waitFor(() => {
      expect(result.current.isToggling).toBe(true);
      expect(result.current.toggleError).toBeNull();
    });

    await act(async () => {
      resolveSecond(true);
      await Promise.resolve();
    });

    expect(result.current.isToggling).toBe(false);
    expect(result.current.toggleError).toBeNull();
    consoleErrorSpy.mockRestore();
  });

  it('clears toggleError when incidentId changes so errors do not leak across incidents', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHasEscalated.mockImplementation((incidentId: string) => incidentId === 'inc-a');
    mockSyncEscalationState.mockResolvedValue(false);
    mockToggleEscalation.mockRejectedValueOnce(new Error('write failed on A'));

    const { useEscalation } = await loadHook();
    const { result, rerender } = renderHook(
      ({ incidentId }) => useEscalation(incidentId),
      { initialProps: { incidentId: 'inc-a' as string | null } },
    );

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.toggleError).toBeInstanceOf(Error);
    expect(result.current.toggleError?.message).toBe('write failed on A');

    rerender({ incidentId: 'inc-b' });

    await waitFor(() => {
      expect(result.current.toggleError).toBeNull();
    });

    consoleErrorSpy.mockRestore();
  });

  it('ignores a late toggle rejection from the previous incident after incidentId changes', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHasEscalated.mockImplementation((id: string) => id === 'inc-a');
    mockSyncEscalationState.mockResolvedValue(false);

    let rejectOldToggle!: (err: Error) => void;
    mockToggleEscalation.mockImplementationOnce(
      () =>
        new Promise<boolean>((_, reject) => {
          rejectOldToggle = reject;
        }),
    );

    const { useEscalation } = await loadHook();
    const { result, rerender } = renderHook(
      ({ incidentId }) => useEscalation(incidentId),
      { initialProps: { incidentId: 'inc-a' as string | null } },
    );

    await act(async () => {
      void result.current.toggle();
    });

    await waitFor(() => {
      expect(result.current.isToggling).toBe(true);
      expect(result.current.escalated).toBe(false);
    });

    rerender({ incidentId: 'inc-b' });

    await waitFor(() => {
      expect(result.current.isToggling).toBe(false);
      expect(result.current.toggleError).toBeNull();
      expect(result.current.escalated).toBe(false);
    });

    await act(async () => {
      rejectOldToggle(new Error('old incident write failed'));
      await Promise.resolve();
    });

    expect(result.current.isToggling).toBe(false);
    expect(result.current.toggleError).toBeNull();
    expect(result.current.escalated).toBe(false);
    // Stale completion is ignored entirely, so no fresh toggle-error log.
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      '[useEscalation] Toggle failed:',
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it('falls back to cached state and logs when syncEscalationState rejects', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Cache says true; the Firestore sync fails (auth expiry, rule denial,
    // network outage). The hook must keep showing the cached value and
    // surface the failure via the console log — without this test the
    // rejection branch in the `.catch` handler is dead code.
    mockHasEscalated.mockReturnValue(true);
    mockSyncEscalationState.mockRejectedValue(new Error('sync denied'));

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-sync-fail'));

    // Cached value paints immediately.
    expect(result.current.escalated).toBe(true);

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useEscalation] syncEscalationState failed:',
        expect.any(Error),
      );
    });

    // The cache wins — no authoritative state to replace it with.
    expect(result.current.escalated).toBe(true);
    consoleErrorSpy.mockRestore();
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

  it('unsubscribes from the escalation event channel on unmount', async () => {
    // The effect's cleanup calls `unsubscribe()`. Without this test a
    // regression that drops the return handler would leak listeners
    // across every incident-overlay open/close cycle with zero CI
    // signal — the symptom would only show up as drifting memory in
    // long-running sessions. We verify behaviourally (dispatching to
    // the listener after unmount must not throw through the React tree
    // because nothing is listening anymore).
    mockHasEscalated.mockReturnValue(false);
    mockSyncEscalationState.mockResolvedValue(false);

    const { useEscalation } = await loadHook();
    const { unmount } = renderHook(() => useEscalation('inc-unmount'));

    // Listener is bound while mounted.
    expect(activeListener).not.toBeNull();

    unmount();

    // The hook's cleanup ran `unsubscribe()`, which in the test double
    // clears `activeListener`. A regression that forgot to invoke the
    // cleanup would leave the stale reference in place.
    expect(activeListener).toBeNull();
  });
});

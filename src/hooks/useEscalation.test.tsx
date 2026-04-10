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
      result.current.toggle().catch(() => {});
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
      result.current.toggle().catch(() => {});
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
      result.current.toggle().catch(() => {});
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
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
      result.current.toggle().catch(() => {});
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
    // Stale completion does not produce a user-visible error (the UI has
    // moved on), and does NOT use the production-error channel — otherwise
    // operators would get paged for a race that the hook already absorbed.
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      '[useEscalation] Toggle failed:',
      expect.any(Error),
    );
    // ...but it MUST leave a warning-level breadcrumb so a genuine late
    // Firestore failure is still observable in production logs. A regression that
    // silently swallowed the rejection entirely would lose the only signal
    // a developer has that the race was triggered in the first place.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[useEscalation] Ignoring stale toggle failure for previous epoch',
      expect.objectContaining({ err: expect.any(Error) }),
    );
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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

  it('discards an in-flight sync response that resolves after a subscription event', async () => {
    // useEscalation.ts bumps `localMutationEpochRef` inside the subscription
    // listener specifically so a slow sync resolving AFTER a subscription
    // event cannot clobber the authoritative state the subscription already
    // delivered. Without this epoch bump the following race would be
    // observable: (a) mount starts sync, (b) subscription fires with
    // `escalated: true`, UI shows true, (c) sync resolves with `false`
    // (stale read), UI silently flips back to false. The test forces that
    // ordering by holding the sync promise open across the listener fire.
    mockHasEscalated.mockReturnValue(false);
    let resolveSync!: (value: boolean) => void;
    mockSyncEscalationState.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSync = resolve;
        }),
    );

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-epoch'));

    // The sync has been kicked off but is still pending. A subscription
    // event now delivers the authoritative state.
    expect(result.current.escalated).toBe(false);

    act(() => {
      activeListener?.({ incidentId: 'inc-epoch', escalated: true });
    });
    expect(result.current.escalated).toBe(true);

    // The stale sync resolves with a value that disagrees with the
    // subscription. Because the subscription listener bumped the epoch,
    // the sync's `.then` must early-return without touching state.
    await act(async () => {
      resolveSync(false);
      await Promise.resolve();
    });

    expect(result.current.escalated).toBe(true);
  });

  it('guards re-entry synchronously so two rapid toggles cannot both begin', async () => {
    // React state updates are async, so `isToggling` in the toggle closure
    // lags by a render: two toggles dispatched in the same tick would both
    // observe `isToggling === false` and issue concurrent writes + conflicting
    // optimistic UI. The hook must therefore hold the guard in a ref that
    // flips synchronously before any await. A regression that reverted the
    // guard to `isToggling` state would let both calls through and fail this
    // test on the `mockToggleEscalation` call count.
    mockHasEscalated.mockReturnValue(false);
    mockSyncEscalationState.mockResolvedValue(false);

    // Hold the first call open so the second call has a chance to observe
    // the in-flight state and (incorrectly, under a buggy guard) start its
    // own toggle.
    let resolveFirst!: (value: boolean) => void;
    mockToggleEscalation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { useEscalation } = await loadHook();
    const { result } = renderHook(() => useEscalation('inc-reentry'));

    await act(async () => {
      // Dispatch two toggles synchronously in the same tick. The second call
      // must early-return without invoking `toggleEscalation`.
      result.current.toggle().catch(() => {});
      result.current.toggle().catch(() => {});
    });

    expect(mockToggleEscalation).toHaveBeenCalledTimes(1);
    expect(result.current.isToggling).toBe(true);
    // Optimistic flip happened exactly once — a double-toggle would have
    // flipped twice and landed back on the starting value.
    expect(result.current.escalated).toBe(true);

    await act(async () => {
      resolveFirst(true);
      await Promise.resolve();
    });

    expect(result.current.isToggling).toBe(false);
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

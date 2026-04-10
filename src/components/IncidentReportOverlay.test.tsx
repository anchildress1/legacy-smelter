import { act, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `useEscalation` itself is covered in src/hooks/useEscalation.test.tsx —
// this suite pins the UI side of the contract: when the hook surfaces a
// non-null `toggleError`, the overlay must render a visible role="alert"
// showing `err.message`, and it must unmount that alert when the error
// clears. Without this test, a regression that drops the `toggleError`
// destructure from the component would be silent in CI because the
// hook-level tests never exercise the render output.
//
// This suite also pins the LIVE-COUNTS stale indicator and the BREACH
// error surface. Both sit alongside the escalation error to give the
// user a consistent signal whenever anything backing the counter row
// stops advancing or fails to write.

type EscalationState = {
  escalated: boolean;
  isToggling: boolean;
  toggleError: Error | null;
  toggle: () => Promise<void>;
};

const escalationState: EscalationState = {
  escalated: false,
  isToggling: false,
  toggleError: null,
  toggle: vi.fn(async () => {}),
};

vi.mock('../hooks/useEscalation', () => ({
  useEscalation: () => escalationState,
}));

// recordBreach is controlled per-test via `mockRecordBreachResult`.
// Default is a success result so the happy-path tests do not need to
// reset it. The breach error surface tests override this to return a
// failing result and assert the overlay renders the error alert. Note
// that `BreachResult.error` is a string (see breachService.ts) — the
// overlay wraps it in an Error for rendering.
type BreachResultMock = {
  readonly ok: boolean;
  readonly skipped?: 'cooldown' | 'in_flight';
  readonly error?: string;
};
const mockRecordBreachResult: { current: BreachResultMock | Error } = {
  current: { ok: true },
};
vi.mock('../services/breachService', () => ({
  recordBreach: vi.fn(async () => {
    const value = mockRecordBreachResult.current;
    if (value instanceof Error) throw value;
    return value;
  }),
}));

// `onSnapshot` is now controllable per-test. The default is a no-op
// unsubscribe, but the stale-indicator tests capture the next/error
// callbacks and fire them synchronously so the component's state
// transitions can be asserted without a real Firestore.
type SnapshotNext = (snap: {
  exists: () => boolean;
  data: () => Record<string, unknown>;
}) => void;
type SnapshotError = (err: Error) => void;
const snapshotHandlers: {
  next: SnapshotNext | null;
  error: SnapshotError | null;
} = { next: null, error: null };
vi.mock('../firebase', () => ({
  db: { __db: true },
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  onSnapshot: vi.fn(
    (_ref: unknown, next: SnapshotNext, error?: SnapshotError) => {
      snapshotHandlers.next = next;
      snapshotHandlers.error = error ?? null;
      return () => {
        snapshotHandlers.next = null;
        snapshotHandlers.error = null;
      };
    },
  ),
}));

import { IncidentReportOverlay } from './IncidentReportOverlay';
import type { SmeltAnalysis } from '../services/geminiService';

function makeAnalysis(): SmeltAnalysis {
  return {
    legacyInfraClass: 'Artifact Node',
    diagnosis: 'Critical mismatch detected',
    dominantColors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'],
    chromaticProfile: 'Thermal Beige',
    systemDx: 'Acute Drift Syndrome',
    severity: 'Severe',
    primaryContamination: 'Legacy residue',
    contributingFactor: 'Config rot',
    failureOrigin: 'Deferred upgrades',
    disposition: 'Immediate thermal decommission',
    incidentFeedSummary: 'Critical legacy artifact queued for smelting.',
    archiveNote: 'System observed dangerous drift.',
    ogHeadline: 'Legacy artifact breached thermal policy',
    shareQuote: 'Containment failed. Smelting initiated.',
    anonHandle: 'ThermalOperator_41',
    pixelCount: 1,
    subjectBox: [0, 0, 1000, 1000],
    incidentId: 'incident-1',
  };
}

function resetEscalationState() {
  escalationState.escalated = false;
  escalationState.isToggling = false;
  escalationState.toggleError = null;
  escalationState.toggle = vi.fn(async () => {});
}

describe('IncidentReportOverlay escalation error surface', () => {
  beforeAll(() => {
    // jsdom does not implement <dialog>.showModal / close. Stub them so the
    // overlay's mount effect can run without throwing. The rendered content
    // lives inside the <dialog> element regardless of whether the native
    // modal is actually opened.
    if (typeof HTMLDialogElement !== 'undefined') {
      if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
        HTMLDialogElement.prototype.showModal = function showModal() {
          this.setAttribute('open', '');
        };
      }
      if (typeof HTMLDialogElement.prototype.close !== 'function') {
        HTMLDialogElement.prototype.close = function close() {
          this.removeAttribute('open');
        };
      }
    }
  });

  beforeEach(() => {
    resetEscalationState();
    mockRecordBreachResult.current = { ok: true };
    snapshotHandlers.next = null;
    snapshotHandlers.error = null;
  });

  it('renders the escalation error alert when toggleError is non-null', () => {
    escalationState.toggleError = new Error('firestore denied write');

    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    // The message text must be surfaced verbatim so a future refactor that
    // wraps the error (e.g. `new Error('Escalation failed')`) cannot
    // silently strip the real cause from the UI.
    expect(within(alert).getByText(/firestore denied write/i)).toBeInTheDocument();
  });

  it('does not render an alert when toggleError is null', () => {
    // Baseline: the surface only exists when the hook supplies an error.
    // A regression that always renders the alert (even on null) would
    // spam the UI on initial mount before any toggle has been attempted.
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not render the escalation UI or its error alert when incidentId is missing', () => {
    // The escalate button (and therefore its error surface) is gated on
    // `incidentId` being non-null. If the component ever leaks a rendered
    // alert when no incident is attached, this test catches it.
    escalationState.toggleError = new Error('should not appear');

    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId={null}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /escalate/i })).toBeNull();
  });

  it('unmounts the alert when the hook clears toggleError on rerender', () => {
    // Pins the clear path: the hook sets toggleError to null at the top of
    // each successful toggle. When the component rerenders with the cleared
    // value, the alert DOM node must be gone — not just visually hidden.
    escalationState.toggleError = new Error('first fail');

    const { rerender } = render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    resetEscalationState();
    rerender(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the stale indicator when the Firestore snapshot rejects invalid counters', () => {
    // The live-counts subscription guards against `sanction_count` /
    // `breach_count` / `escalation_count` drifting to non-numeric
    // shapes. Before this test, the guard at lines 246-252 of
    // IncidentReportOverlay.tsx was dead to the suite — a regression
    // that dropped the guard would feed `NaN` into the Impact
    // computation and silently render `NaN` in the stats row.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    // No stale indicator before the snapshot delivers garbage.
    expect(screen.queryByTestId('incident-stale-indicator')).toBeNull();

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({
          sanction_count: 'nope',
          breach_count: 0,
          escalation_count: 0,
        }),
      });
    });

    const indicator = screen.getByTestId('incident-stale-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toMatch(/schema drift/i);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid counter fields'),
      expect.objectContaining({ sanction_count: 'nope' }),
    );
    // The stats row DOM stays seeded from the initial analysis → no
    // NaN leaks into the rendered impact cell.
    const statsRow = screen.getByTestId('incident-stats-row');
    expect(statsRow.dataset.liveStale).toBe('schema');
    expect(statsRow.textContent).not.toContain('NaN');

    consoleErrorSpy.mockRestore();
  });

  it('treats non-finite counter values as stale schema and avoids NaN impact output', () => {
    // `typeof NaN === "number"`, so a type-only guard would let this through
    // and render `Impact: NaN`. Pin the finite-number invariant explicitly.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => true,
        data: () => ({
          sanction_count: Number.NaN,
          breach_count: -1,
          escalation_count: Number.POSITIVE_INFINITY,
        }),
      });
    });

    const indicator = screen.getByTestId('incident-stale-indicator');
    expect(indicator.textContent).toMatch(/schema drift/i);
    expect(screen.getByTestId('incident-stats-row').dataset.liveStale).toBe('schema');
    expect(screen.getByTestId('incident-stats-row').textContent).not.toContain('NaN');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid counter fields'),
      expect.objectContaining({
        sanction_count: Number.NaN,
        breach_count: -1,
        escalation_count: Number.POSITIVE_INFINITY,
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it('renders the stale indicator when the incident doc is removed from the archive', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    act(() => {
      snapshotHandlers.next?.({
        exists: () => false,
        data: () => ({}),
      });
    });

    const indicator = screen.getByTestId('incident-stale-indicator');
    expect(indicator.textContent).toMatch(/incident removed from archive/i);
    expect(screen.getByTestId('incident-stats-row').dataset.liveStale).toBe('removed');
    consoleErrorSpy.mockRestore();
  });

  it('renders the stale indicator when the snapshot subscription errors', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    act(() => {
      snapshotHandlers.error?.(new Error('rules denied'));
    });

    const indicator = screen.getByTestId('incident-stale-indicator');
    expect(indicator.textContent).toMatch(/subscription errored/i);
    expect(screen.getByTestId('incident-stats-row').dataset.liveStale).toBe('subscription');
    consoleErrorSpy.mockRestore();
  });

  it('renders a breach error alert when recordBreach returns a failing result', async () => {
    // Reconciliation with the escalation error surface. Both writes
    // feed `impact_score` — if escalation has a user-visible alert on
    // failure and breach silently eats errors, the UX is asymmetric
    // and the user has no idea why their "copy brief" click didn't
    // register a breach. A regression that reverted the breach error
    // surface to console-only would fail this test directly.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRecordBreachResult.current = { ok: false, error: 'write denied' };

    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    // Trigger a breach via the copy-brief button. Clipboard writes can
    // reject in jsdom — stub `navigator.clipboard` to resolve so the
    // code path reaches `recordBreachAsync`.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });

    await act(async () => {
      screen.getByRole('button', { name: /copy brief/i }).click();
      // Resolve clipboard microtask + recordBreach microtask.
      await Promise.resolve();
      await Promise.resolve();
    });

    const breachAlert = screen.getByTestId('breach-error');
    expect(breachAlert).toBeInTheDocument();
    expect(breachAlert.textContent).toMatch(/write denied/i);
    consoleErrorSpy.mockRestore();
  });
});

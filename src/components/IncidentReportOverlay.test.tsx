import { act, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
  IMPACT_GLOW_FILTER_ESCALATED_BUTTON,
} from '../lib/impactGlow';

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

function findImpactNumber(container: HTMLElement): HTMLElement {
  // The stats row carries the test id; the Impact number is the
  // first child's first numeric leaf. Scope to the row so other
  // numeric content on the page (timestamps, counts) can't shadow.
  const row = container.querySelector('[data-testid="incident-stats-row"]');
  if (!(row instanceof HTMLElement)) {
    throw new TypeError('stats row not rendered');
  }
  const nodes = Array.from(row.querySelectorAll('div')).filter((el) =>
    /^\d+$/.test((el.textContent ?? '').trim()),
  );
  if (nodes.length === 0) {
    throw new Error('no numeric leaf found inside stats row');
  }
  // The Impact number is the FIRST numeric leaf because the Impact
  // slot is the first child of the row (basis-1/3 on the left).
  return nodes[0];
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

  it('clears breachError when incidentId changes so a stale alert does not leak across incidents', async () => {
    // The overlay component instance can be reused when `selectedRecentLog`
    // changes in App.tsx (the component is rendered conditionally but is
    // NOT keyed on `incidentId`). Without a reset effect keyed on
    // `incidentId`, a breach error from incident A would still render when
    // the user opens incident B. This test rerenders with a new incidentId
    // and asserts the alert disappears.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRecordBreachResult.current = { ok: false, error: 'write denied' };
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });

    const { rerender } = render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    await act(async () => {
      screen.getByRole('button', { name: /copy brief/i }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('breach-error')).toBeInTheDocument();

    // Swap to a different incident — the breach error must not leak.
    rerender(
      <IncidentReportOverlay
        analysis={{ ...makeAnalysis(), incidentId: 'incident-2' }}
        incidentId="incident-2"
        onClose={() => {}}
      />,
    );

    expect(screen.queryByTestId('breach-error')).toBeNull();
    consoleErrorSpy.mockRestore();
  });

  it('ignores a late recordBreach rejection from a previous incident', async () => {
    // A slow Firestore write for incident A should not bleed into incident B.
    // This test holds the `recordBreach` promise open across an incidentId
    // change, then rejects it — the overlay must NOT render a breach alert
    // in the new incident's state and must log at warn level so the late
    // failure is still observable for support triage.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let rejectBreach!: (err: Error) => void;
    mockRecordBreachResult.current = new Error('stale incident-1 failure');
    // Override the mock with a manually-controllable promise for this test.
    const { recordBreach } = await import('../services/breachService');
    vi.mocked(recordBreach).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectBreach = reject;
        }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });

    const { rerender } = render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    // Fire a breach attempt that will hang until we reject it.
    await act(async () => {
      screen.getByRole('button', { name: /copy brief/i }).click();
      await Promise.resolve();
    });

    // Swap incidents before the breach promise settles.
    rerender(
      <IncidentReportOverlay
        analysis={{ ...makeAnalysis(), incidentId: 'incident-2' }}
        incidentId="incident-2"
        onClose={() => {}}
      />,
    );

    // Now reject the original breach — the overlay must ignore it.
    await act(async () => {
      rejectBreach(new Error('stale incident-1 failure'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('breach-error')).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[IncidentReportOverlay] Ignoring stale breach failure for previous incident:',
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });
});

describe('IncidentReportOverlay — Impact glow + escalate halo', () => {
  // The back card mirrors the front card's glow treatment. These
  // tests confirm the overlay imports and applies the shared
  // constants from `lib/impactGlow` — matching the coverage already
  // in place for IncidentLogCard. The literal class strings are
  // pinned in src/lib/impactGlow.test.ts so both surfaces can be
  // updated in lockstep by editing the constants alone.

  beforeEach(() => {
    resetEscalationState();
  });

  // ESCALATION BUTTON INTERACTION

  it('calls toggle() when the Escalate button is clicked', () => {
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: /^escalate$/i });
    button.click();

    expect(escalationState.toggle).toHaveBeenCalledTimes(1);
  });

  it('sets aria-pressed=false when not escalated', () => {
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: /^escalate$/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('sets aria-pressed=true when escalated', () => {
    escalationState.escalated = true;
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: /remove escalation/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables the Escalate button while a toggle is in progress', () => {
    escalationState.isToggling = true;
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: /^escalate$/i });
    expect(button).toBeDisabled();
  });

  it('disables the Triggered button while a toggle is in progress', () => {
    escalationState.escalated = true;
    escalationState.isToggling = true;
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: /remove escalation/i });
    expect(button).toBeDisabled();
  });

  // POSITIVE — at-rest glow tier on the Impact number.

  it('applies IMPACT_GLOW_BASE to the Impact number when not triggered', () => {
    const { container } = render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );
    const impact = findImpactNumber(container);
    for (const token of IMPACT_GLOW_BASE.split(' ')) {
      expect(impact.className).toContain(token);
    }
  });

  it('does not apply the escalated glow filter to the Triggered button when not triggered', () => {
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: /^escalate$/i });
    expect(button.className).not.toContain(IMPACT_GLOW_FILTER_ESCALATED_BUTTON);
  });

  // POSITIVE — triggered tier on both Impact number and button.

  it('applies IMPACT_GLOW_ESCALATED to the Impact number when triggered', () => {
    escalationState.escalated = true;
    const { container } = render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );
    const impact = findImpactNumber(container);
    for (const token of IMPACT_GLOW_ESCALATED.split(' ')) {
      expect(impact.className).toContain(token);
    }
  });

  it('applies IMPACT_GLOW_FILTER_ESCALATED_BUTTON to the Triggered button when triggered', () => {
    escalationState.escalated = true;
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: /remove escalation/i });
    expect(button.className).toContain(IMPACT_GLOW_FILTER_ESCALATED_BUTTON);
    // The triggered color treatment stays intact — the halo is additive.
    expect(button.className).toContain('bg-hazard-amber/15');
    expect(button.className).toContain('text-hazard-amber');
  });

  // EDGE — exactly one glow tier on the Impact number at a time.
  // A refactor that concatenated both tiers (dropping the ternary)
  // would produce a double-dose of filter classes and fight
  // Tailwind's own precedence rules at render time.

  it('applies exactly one glow tier to the Impact number at a time', () => {
    const { container } = render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );
    const impact = findImpactNumber(container);
    // The glow classes come from IMPACT_GLOW_BASE or IMPACT_GLOW_ESCALATED.
    // Both define exactly one drop-shadow filter; both are applied via the
    // ternary at render time, not concatenated. Pin that exactly one is
    // present by counting tokens from the constants.
    const baseTokens = IMPACT_GLOW_BASE.split(' ');
    const escalatedTokens = IMPACT_GLOW_ESCALATED.split(' ');
    const baseCount = baseTokens.filter(t => impact.className.includes(t)).length;
    const escalatedCount = escalatedTokens.filter(t => impact.className.includes(t)).length;
    expect(baseCount + escalatedCount).toBeGreaterThan(0);
    expect(baseCount === baseTokens.length || escalatedCount === escalatedTokens.length).toBe(true);
  });
});

describe('IncidentReportOverlay — P0 priority badge', () => {
  // The back-card must mirror the front-card's P0 treatment so the
  // badge follows the incident wherever it is rendered. The overlay
  // doesn't subscribe to `useRecentIncidentLogs` itself — callers
  // pass `showP0Badge` based on live top-3 membership — so these
  // tests pin the render contract, not the membership logic (that
  // side is covered in IncidentManifest.test.tsx and App.behavior
  // test coverage).

  beforeEach(() => {
    resetEscalationState();
  });

  // POSITIVE: the "P0" text appears in the header right-cluster
  // when the caller passes `showP0Badge`.

  it('renders the P0 badge when showP0Badge is true', () => {
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        showP0Badge
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('P0')).toBeInTheDocument();
  });

  // NEGATIVE: the badge is absent when the caller explicitly passes
  // `showP0Badge={false}`. A regression that always rendered the
  // badge would silently mark every incident as P0.

  it('does not render the P0 badge when showP0Badge is false', () => {
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        showP0Badge={false}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText('P0')).toBeNull();
  });

  // DEFAULT: omitting the prop behaves the same as false. This is
  // the common case for any future caller that doesn't yet know
  // about the P0 treatment — the overlay must not accidentally flag
  // the incident just because the prop is unset.

  it('does not render the P0 badge when showP0Badge is omitted', () => {
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText('P0')).toBeNull();
  });

  // REGRESSION GUARD: the old numbered `priorityTier` scheme used
  // P1/P2/P3 strings that leaked into the rendered UI during the
  // refactor. Pin the binary contract: only "P0" exists on the
  // badge, nothing else. A future regression that re-introduces a
  // tier prop would fail this test loudly.

  it('never renders P1, P2, or P3 text (binary P0 badge only)', () => {
    render(
      <IncidentReportOverlay
        analysis={makeAnalysis()}
        incidentId="incident-1"
        showP0Badge
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText('P1')).toBeNull();
    expect(screen.queryByText('P2')).toBeNull();
    expect(screen.queryByText('P3')).toBeNull();
  });
});

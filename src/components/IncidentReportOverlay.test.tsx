import { render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `useEscalation` itself is covered in src/hooks/useEscalation.test.tsx —
// this suite pins the UI side of the contract: when the hook surfaces a
// non-null `toggleError`, the overlay must render a visible role="alert"
// showing `err.message`, and it must unmount that alert when the error
// clears. Without this test, a regression that drops the `toggleError`
// destructure from the component would be silent in CI because the
// hook-level tests never exercise the render output.

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

vi.mock('../services/breachService', () => ({
  recordBreach: vi.fn(async () => ({ ok: true })),
}));

// `onSnapshot` never fires in these tests — the overlay seeds its live
// counts from the passed `log`/`analysis` and only updates them from
// snapshot callbacks. Returning a no-op unsubscribe keeps the effect
// tidy without needing a real Firestore mock.
vi.mock('../firebase', () => ({
  db: { __db: true },
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  onSnapshot: vi.fn(() => () => {}),
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
});

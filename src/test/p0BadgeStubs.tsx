import type { SmeltLog } from '../types';

type IncidentLogCardStubProps = {
  log: SmeltLog;
  showP0Badge?: boolean;
  onClick: () => void;
};

export function createIncidentLogCardP0Stub(
  testId = 'incident-log-card-stub',
) {
  return function IncidentLogCardP0Stub({
    log,
    showP0Badge,
    onClick,
  }: IncidentLogCardStubProps) {
    return (
      <button
        type="button"
        data-testid={testId}
        data-log-id={log.id}
        data-show-p0={showP0Badge ? 'true' : 'false'}
        onClick={onClick}
        aria-label={`open ${log.id}`}
      />
    );
  };
}

export const IncidentLogCardP0Stub = createIncidentLogCardP0Stub();

type IncidentReportOverlayStubProps = {
  incidentId?: string | null;
  showP0Badge?: boolean;
};

export function createIncidentReportOverlayP0Stub(
  testId = 'incident-report-overlay-stub',
) {
  return function IncidentReportOverlayP0Stub({
    incidentId,
    showP0Badge,
  }: IncidentReportOverlayStubProps) {
    return (
      <div
        data-testid={testId}
        data-incident-id={incidentId ?? ''}
        data-show-p0={showP0Badge ? 'true' : 'false'}
      />
    );
  };
}

export const IncidentReportOverlayP0Stub =
  createIncidentReportOverlayP0Stub();

import type { FC } from 'react';
import type { SmeltLog } from '../types';
import { StatItem } from './StatItem';
import {
  IMPACT_GLOW_BASE,
  IMPACT_GLOW_ESCALATED,
} from '../lib/impactGlow';

interface IncidentMetricsRowProps {
  impact: number;
  escalated: boolean;
  log: SmeltLog;
  testIdPrefix: string;
}

export const IncidentMetricsRow: FC<IncidentMetricsRowProps> = ({
  impact,
  escalated,
  log,
  testIdPrefix,
}) => (
  <>
    <span className="flex items-center gap-1">
      <span
        data-testid={`${testIdPrefix}-impact-number`}
        className={`font-mono text-lg font-black leading-none transition-all ${
          escalated ? IMPACT_GLOW_ESCALATED : IMPACT_GLOW_BASE
        }`}
      >
        {impact}
      </span>
      <span className="text-[9px] font-mono uppercase tracking-wider font-bold text-hazard-amber">Impact</span>
    </span>
    <span className="w-px h-3 bg-concrete-border" aria-hidden="true" />
    {[
      { value: log.sanction_count, label: 'Sanctions' },
      { value: log.escalation_count, label: 'Escalations' },
      { value: log.breach_count, label: 'Breaches' },
    ].map(({ value, label }) => (
      <StatItem key={label} value={value} label={label} />
    ))}
  </>
);

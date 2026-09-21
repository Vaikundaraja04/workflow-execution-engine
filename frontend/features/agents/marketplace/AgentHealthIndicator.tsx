'use client';

import * as React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import type { AgentHealthReportDTO } from '@/types/agentMarketplace';

const BAND_VARIANT: Record<AgentHealthReportDTO['band'], BadgeProps['variant']> = {
  HEALTHY: 'success',
  WATCH: 'warning',
  AT_RISK: 'destructive',
};

export interface AgentHealthIndicatorProps {
  report: AgentHealthReportDTO;
  showSignals?: boolean;
}

export function AgentHealthIndicator({ report, showSignals = false }: AgentHealthIndicatorProps) {
  return (
    <div className="space-y-1" data-testid="agent-health-indicator">
      <div className="flex items-center gap-2">
        <Badge variant={BAND_VARIANT[report.band]} size="sm">
          {report.band}
        </Badge>
        <span className="text-xs font-semibold">{report.score}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          confidence {report.confidence}
        </span>
      </div>
      {showSignals ? (
        <p className="text-[10px] text-muted-foreground">
          adoption {Math.round(report.signals.versionAdoption * 100)}% | failures{' '}
          {Math.round(report.signals.failureRate * 100)}% | tool errors{' '}
          {Math.round(report.signals.toolErrorRate * 100)}% | violations {report.signals.policyViolations}
        </p>
      ) : null}
    </div>
  );
}

export default AgentHealthIndicator;
'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CheckCircle2, TrendingUp } from 'lucide-react';
import type { ExecutionMetrics } from '@/types/analytics';
import type { WorkflowExecution } from '@/types/execution';

export interface SuccessRateProps {
  rate?: number;
  metrics?: ExecutionMetrics | null;
  executions?: WorkflowExecution[];
  isLoading?: boolean;
}

export const SuccessRate: React.FC<SuccessRateProps> = ({
  rate,
  metrics,
  executions = [],
  isLoading = false,
}) => {
  let calculatedRate = rate ?? metrics?.successRate;

  if (calculatedRate === undefined) {
    if (executions.length > 0) {
      const completed = executions.filter((e) => e.status === 'SUCCEEDED' || e.status === 'COMPLETED').length;
      calculatedRate = (completed / executions.length) * 100;
    } else {
      calculatedRate = 100;
    }
  }

  const isHealthy = calculatedRate >= 95;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-16 bg-muted rounded"></div>
            <div className="h-4 w-32 bg-muted rounded"></div>
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold">{calculatedRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              <span>Reliability benchmark</span>
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              <Badge variant={isHealthy ? 'success' : 'warning'} size="sm">
                {isHealthy ? 'Healthy SLA' : 'Action Needed'}
              </Badge>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SuccessRate;

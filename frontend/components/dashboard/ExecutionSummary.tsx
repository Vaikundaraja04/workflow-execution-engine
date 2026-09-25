'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Activity } from 'lucide-react';
import type { ExecutionMetrics } from '@/types/analytics';
import type { WorkflowExecution } from '@/types/execution';

export interface ExecutionSummaryProps {
  metrics?: ExecutionMetrics | null;
  executions?: WorkflowExecution[];
  totalExecutions?: number;
  isLoading?: boolean;
}

export const ExecutionSummary: React.FC<ExecutionSummaryProps> = ({
  metrics,
  executions = [],
  totalExecutions,
  isLoading = false,
}) => {
  const total = totalExecutions ?? metrics?.totalExecutions ?? executions.length;
  const successful = metrics?.successfulExecutions ?? executions.filter((e) => e.status === 'SUCCEEDED' || e.status === 'COMPLETED').length;
  const failed = metrics?.failedExecutions ?? executions.filter((e) => e.status === 'FAILED').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Execution Summary</CardTitle>
        <Activity className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-16 bg-muted rounded"></div>
            <div className="h-4 w-32 bg-muted rounded"></div>
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">{successful} success</span>
              <span>•</span>
              <span className="text-destructive font-medium">{failed} failed</span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ExecutionSummary;

'use client';

import * as React from 'react';
import type { IWorkflowOptimizationPlan } from '@/types/optimization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { History } from 'lucide-react';

interface OptimizationHistoryProps {
  plans: IWorkflowOptimizationPlan[];
  onSelect?: (planId: string) => void;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  APPLIED: 'default',
  REJECTED: 'destructive',
  FAILED: 'destructive',
};

export function OptimizationHistory({ plans, onSelect }: OptimizationHistoryProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Optimization History</CardTitle>
        <History className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {plans.length === 0 ? (
          <p className="text-xs text-muted-foreground">No optimization plans recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => (
              <button
                key={plan._id}
                type="button"
                onClick={() => onSelect?.(plan._id)}
                className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <div className="space-y-0.5">
                  <p className="text-xs font-medium">{plan.type.replace(/_/g, ' ')}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {plan.recommendations.length} recommendation{plan.recommendations.length === 1 ? '' : 's'} |{' '}
                    {new Date(plan.createdAt).toLocaleString()}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[plan.status] ?? 'outline'} size="sm">
                  {plan.status}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OptimizationHistory;
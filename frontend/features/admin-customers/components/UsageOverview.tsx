'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatBytes } from '@/features/customer-console/components/UsageDashboard';
import type { CustomerDetailDTO } from '@/types/saas';

export function UsageOverview({ usage }: { usage: CustomerDetailDTO['usage'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Usage</CardTitle>
        <CardDescription>Workspace counters recorded by the usage service.</CardDescription>
      </CardHeader>
      <CardContent>
        {usage ? (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Total workflows</dt>
              <dd className="font-medium text-foreground">{usage.totalWorkflows.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Executions this month</dt>
              <dd className="font-medium text-foreground">{usage.monthlyExecutions.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Storage used</dt>
              <dd className="font-medium text-foreground">{formatBytes(usage.storageUsed)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last updated</dt>
              <dd className="font-medium text-foreground">
                {new Date(usage.updatedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            No usage counters have been recorded for this workspace yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default UsageOverview;

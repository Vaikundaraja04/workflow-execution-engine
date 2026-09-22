'use client';

import { useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useResource } from '@/hooks/useResource';
import { customerApi } from '@/services/customerApi';

export function UsagePanel({ workspaceId }: { workspaceId: string }) {
  const load = useCallback(
    () => (workspaceId ? customerApi.getUsage(workspaceId) : Promise.resolve(null)),
    [workspaceId],
  );
  const usage = useResource(load);

  if (usage.isLoading) return <Loading message="Loading usage..." />;
  if (usage.error) {
    return (
      <ErrorState
        title="Could not load usage"
        message={usage.error.message}
        onRetry={usage.reload}
      />
    );
  }
  if (!usage.data) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Select a workspace to load its recorded usage."
      />
    );
  }

  const data = usage.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Usage</CardTitle>
        <CardDescription>
          Metered for {data.periodKey}
          {data.plan ? ` on the ${data.plan} plan` : ''} - the Phase 13 usage records, never recomputed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.metrics.length === 0 ? (
          <p className="text-sm text-gray-500">No usage recorded in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead>Percent</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.metrics.map((metric) => (
                <TableRow key={metric.metric}>
                  <TableCell>{metric.metric}</TableCell>
                  <TableCell>{metric.value}</TableCell>
                  <TableCell>{metric.limit === null ? 'Unlimited' : metric.limit}</TableCell>
                  <TableCell>{metric.percent}%</TableCell>
                  <TableCell>
                    {metric.alertState}
                    {metric.overage ? ' · overage' : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-gray-400">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

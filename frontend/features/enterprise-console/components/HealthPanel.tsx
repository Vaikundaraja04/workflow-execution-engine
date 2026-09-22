'use client';

import { useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
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
import { enterpriseOperationsApi } from '@/services/enterpriseOperationsApi';
import type { SuccessIntelligenceStatusDTO } from '@/services/enterpriseOperationsApi';

function statusVariant(status: SuccessIntelligenceStatusDTO): 'success' | 'warning' | 'destructive' {
  if (status === 'HEALTHY') return 'success';
  if (status === 'WARNING') return 'warning';
  return 'destructive';
}

export function HealthPanel({ workspaceId }: { workspaceId: string }) {
  const load = useCallback(
    () => (workspaceId ? enterpriseOperationsApi.getCompanyHealth(workspaceId) : Promise.resolve(null)),
    [workspaceId],
  );
  const health = useResource(load);

  if (health.isLoading) return <Loading message="Loading the success intelligence..." />;
  if (health.error) {
    return (
      <ErrorState
        title="Could not load the success intelligence"
        message={health.error.message}
        onRetry={health.reload}
      />
    );
  }
  if (!health.data) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Select a workspace to score its success signals."
      />
    );
  }

  const data = health.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Customer health</CardTitle>
        <CardDescription>
          {data.companyName} · folded from usage, workflow success, AI adoption, team activity and
          support pressure
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs uppercase text-gray-500">Score</p>
            <p className="text-2xl font-semibold text-gray-900">{data.score} / 100</p>
          </div>
          <Badge variant={statusVariant(data.status)}>{data.status}</Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead>Weight</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.components.map((component) => (
              <TableRow key={component.key}>
                <TableCell>{component.label}</TableCell>
                <TableCell>{component.weight}</TableCell>
                <TableCell>{component.score}</TableCell>
                <TableCell>{component.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.risks.length > 0 && (
          <ul className="space-y-1 text-sm text-gray-700">
            {data.risks.map((risk) => (
              <li key={risk.code}>
                {risk.severity} · {risk.message}
              </li>
            ))}
          </ul>
        )}
        {data.recommendations.length > 0 && (
          <ul className="space-y-1 text-xs text-gray-500">
            {data.recommendations.map((recommendation) => (
              <li key={recommendation.code}>
                {recommendation.owner} · {recommendation.action} ({recommendation.priority})
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

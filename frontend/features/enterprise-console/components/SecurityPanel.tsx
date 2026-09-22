'use client';

import { useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import { useResource } from '@/hooks/useResource';
import { securityApi } from '@/services/securityApi';

export function SecurityPanel({ workspaceId }: { workspaceId: string }) {
  const load = useCallback(
    () => (workspaceId ? securityApi.getSecurityDashboard(workspaceId) : Promise.resolve(null)),
    [workspaceId],
  );
  const dashboard = useResource(load);

  if (dashboard.isLoading) return <Loading message="Loading the security dashboard..." />;
  if (dashboard.error) {
    return (
      <ErrorState
        title="Could not load the security dashboard"
        message={dashboard.error.message}
        onRetry={dashboard.reload}
      />
    );
  }
  if (!dashboard.data) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Select a workspace to load its Phase 8 security dashboard."
      />
    );
  }

  const data = dashboard.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Security</CardTitle>
        <CardDescription>
          The Phase 8 security dashboard for this workspace: risk score, open threats and the last
          24 hours of recorded events
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">Risk score</p>
            <p className="text-2xl font-semibold text-gray-900">
              {data.riskScore} · {data.riskCategory}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Open threats</p>
            <p>{data.openThreatsCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Events (24h)</p>
            <p>{data.totalEvents24h}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Failed logins (24h)</p>
            <p>{data.failedLogins24h}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Active sessions</p>
            <p>{data.activeSessionsCount}</p>
          </div>
        </div>
        {data.recentEvents.length === 0 ? (
          <p className="text-sm text-gray-500">No security events recorded.</p>
        ) : (
          <ul className="space-y-1 text-xs text-gray-500">
            {data.recentEvents.slice(0, 5).map((event) => (
              <li key={event._id}>
                {event.severity} · {event.eventType} · {event.status}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

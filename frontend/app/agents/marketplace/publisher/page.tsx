'use client';

import * as React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { agentMarketplaceApi } from '@/services/agentMarketplaceApi';
import { PublisherAnalyticsPanel } from '@/features/agents/marketplace/PublisherAnalyticsPanel';
import type { MarketplaceAnalyticsDTO } from '@/types/agentMarketplace';

function workspaceIdOf(workspace: { _id?: string; id?: string } | null | undefined): string {
  if (!workspace) return '';
  return workspace._id ?? workspace.id ?? '';
}

export default function PublisherAnalyticsPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = workspaceIdOf(currentWorkspace);
  const [analytics, setAnalytics] = React.useState<MarketplaceAnalyticsDTO | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!workspaceId) return;
    void (async () => {
      try {
        setAnalytics(await agentMarketplaceApi.getAnalytics(workspaceId, '90d'));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load publisher analytics');
      }
    })();
  }, [workspaceId]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 dark:bg-gray-900">
      <div className="mb-4">
        <h1 className="text-lg font-bold">Publisher Analytics</h1>
        <p className="text-xs text-muted-foreground">
          Adoption, installs and execution performance for the agents published by this workspace.
        </p>
      </div>
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      ) : null}
      <PublisherAnalyticsPanel analytics={analytics} />
    </div>
  );
}
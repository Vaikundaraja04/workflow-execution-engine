'use client';

import * as React from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { agentMarketplaceApi } from '@/services/agentMarketplaceApi';
import { AgentCard } from './AgentCard';
import { AgentDetailsPanel } from './AgentDetailsPanel';
import { AgentInstallModal } from './AgentInstallModal';
import type {
  AgentMarketplaceDetailsDTO,
  AgentMarketplaceSearchParams,
  AgentMarketplaceListingDTO,
  AgentMarketplaceSortBy,
  AgentVersionComparisonDTO,
  AgentVersionDTO,
  InstallAgentConfigurationDTO,
} from '@/types/agentMarketplace';

const CATEGORIES = [
  'Automation',
  'Data Processing',
  'Integration',
  'AI Workflow',
  'Approval Flow',
  'Monitoring',
  'Notifications',
  'Operations',
  'Security',
];

const SORTS: Array<{ value: AgentMarketplaceSortBy; label: string }> = [
  { value: 'rating', label: 'Top rated' },
  { value: 'installs', label: 'Most installed' },
  { value: 'executions', label: 'Most executed' },
  { value: 'recent', label: 'Recently updated' },
];

function workspaceIdOf(workspace: { _id?: string; id?: string } | null | undefined): string {
  if (!workspace) return '';
  return workspace._id ?? workspace.id ?? '';
}
export function AgentMarketplaceDashboard() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = workspaceIdOf(currentWorkspace);
  const role = currentWorkspace?.role ?? null;
  const canInstall = hasPermission(role, 'AGENT_INSTALL');
  const canManage = hasPermission(role, 'AGENT_MARKETPLACE_MANAGE');

  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [sortBy, setSortBy] = React.useState<AgentMarketplaceSortBy>('rating');
  const [listings, setListings] = React.useState<AgentMarketplaceListingDTO[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dataSource, setDataSource] = React.useState<'live' | 'demo'>('demo');

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<AgentMarketplaceDetailsDTO | null>(null);
  const [versions, setVersions] = React.useState<AgentVersionDTO[]>([]);
  const [comparison, setComparison] = React.useState<AgentVersionComparisonDTO | null>(null);
  const [installedIds, setInstalledIds] = React.useState<Record<string, boolean>>({});
  const [installTarget, setInstallTarget] = React.useState<AgentMarketplaceListingDTO | null>(null);
  const loadListings = React.useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const params: AgentMarketplaceSearchParams = { sortBy };
      if (query) params.q = query;
      if (category) params.category = category;
      const result = await agentMarketplaceApi.searchAgents(workspaceId, params);
      setListings(result.items);
      setDataSource('live');
      setError(null);
    } catch (err) {
      setListings([]);
      setDataSource('demo');
      setError(err instanceof Error ? err.message : 'Failed to load the agent marketplace');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, query, category, sortBy]);

  React.useEffect(() => {
    void loadListings();
  }, [loadListings]);

  const openDetails = React.useCallback(async (listingId: string) => {
    if (!workspaceId) return;
    setSelectedId(listingId);
    setComparison(null);
    try {
      const [detailResult, versionResult] = await Promise.all([
        agentMarketplaceApi.getAgentDetails(listingId, workspaceId),
        agentMarketplaceApi.listVersions(listingId, workspaceId),
      ]);
      setDetails(detailResult);
      setVersions(versionResult);
      setInstalledIds((current) => ({
        ...current,
        [listingId]: detailResult.install?.status === 'ACTIVE',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listing details');
    }
  }, [workspaceId]);
  const confirmInstall = async (configuration: InstallAgentConfigurationDTO) => {
    if (!installTarget || !workspaceId) return;
    try {
      await agentMarketplaceApi.installAgent(installTarget._id, configuration, workspaceId);
      setInstalledIds((current) => ({ ...current, [installTarget._id]: true }));
      setNotice(`Installed ${installTarget.name} as a local agent.`);
      setInstallTarget(null);
      if (selectedId === installTarget._id) await openDetails(installTarget._id);
      await loadListings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install the agent');
    }
  };

  const uninstallSelected = async () => {
    if (!details || !workspaceId) return;
    try {
      await agentMarketplaceApi.uninstallAgent(details.listing._id, workspaceId);
      setInstalledIds((current) => ({ ...current, [details.listing._id]: false }));
      setNotice(`Uninstalled ${details.listing.name}.`);
      await openDetails(details.listing._id);
      await loadListings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to uninstall the agent');
    }
  };

  const submitReview = async (rating: number, review: string) => {
    if (!details || !workspaceId) return;
    try {
      await agentMarketplaceApi.createReview(details.listing._id, rating, review || undefined, workspaceId);
      setNotice('Review recorded.');
      await openDetails(details.listing._id);
      await loadListings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit the review');
    }
  };

  const compare = async (from: number, to: number) => {
    if (!details || !workspaceId) return;
    try {
      setComparison(await agentMarketplaceApi.compareVersions(details.listing._id, from, to, workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compare versions');
    }
  };

  const rollback = async (version: number) => {
    if (!details || !workspaceId) return;
    try {
      await agentMarketplaceApi.rollbackVersion(details.listing._id, version, workspaceId);
      setNotice(`Rolled back ${details.listing.name} to v${version}.`);
      await openDetails(details.listing._id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to roll back the listing');
    }
  };
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Agent Marketplace</h1>
          <p className="text-xs text-muted-foreground">
            Publish, discover, install and review governed AI agents across workspaces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={dataSource === 'live' ? 'success' : 'warning'} size="sm">
            {dataSource === 'live' ? 'Live API Telemetry' : 'Demo Data'}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => void loadListings()} disabled={loading}>
            <RefreshCw className={loading ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            className="rounded-md border border-gray-300 py-1 pl-7 pr-2 text-xs dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as AgentMarketplaceSortBy)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{notice}</div>
      ) : null}

      {listings.length === 0 && !loading ? (
        <EmptyState
          title="No agents match this search"
          description="Try a different category or query, or publish an agent from the agents console."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {listings.map((listing) => (
            <AgentCard
              key={listing._id}
              listing={listing}
              installed={Boolean(installedIds[listing._id])}
              canInstall={canInstall}
              onView={(listingId) => void openDetails(listingId)}
              onInstall={setInstallTarget}
            />
          ))}
        </div>
      )}

      {details ? (
        <AgentDetailsPanel
          details={details}
          versions={versions}
          comparison={comparison}
          canManage={canManage}
          canInstall={canInstall}
          onInstall={() => setInstallTarget(details.listing)}
          onUninstall={() => void uninstallSelected()}
          onCompare={(from, to) => void compare(from, to)}
          onRollback={(version) => void rollback(version)}
          onSubmitReview={(rating, review) => void submitReview(rating, review)}
          onClose={() => {
            setSelectedId(null);
            setDetails(null);
            setVersions([]);
            setComparison(null);
          }}
        />
      ) : null}

      <AgentInstallModal
        listing={installTarget}
        open={installTarget !== null}
        onOpenChange={(open) => {
          if (!open) setInstallTarget(null);
        }}
        onConfirm={confirmInstall}
      />
    </div>
  );
}

export default AgentMarketplaceDashboard;
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { apiClient } from '@/services/apiClient';
import { agentMarketplaceApi } from '@/services/agentMarketplaceApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AgentHealthIndicator } from '@/features/agents/marketplace/AgentHealthIndicator';
import { MarketplaceAnalyticsPanel } from '@/features/agents/marketplace/MarketplaceAnalyticsPanel';
import { RecommendationFeed } from '@/features/agents/marketplace/RecommendationFeed';
import { LifecycleNotifications } from '@/features/agents/marketplace/LifecycleNotifications';
import AgentMarketplacePage from '@/app/agents/marketplace/page';
import PublisherAnalyticsPage from '@/app/agents/marketplace/publisher/page';
import type {
  AgentHealthReportDTO,
  MarketplaceAnalyticsDTO,
  MarketplaceLifecycleDTO,
  MarketplaceRecommendationsDTO,
} from '@/types/agentMarketplace';

vi.mock('@/services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

type MockFn = ReturnType<typeof vi.fn>;
const client = apiClient as unknown as { get: MockFn; post: MockFn; delete: MockFn };
const workspaceHeaders = { headers: { 'X-Workspace-Id': 'workspace-1' } };

const analyticsFixture: MarketplaceAnalyticsDTO = {
  timeframe: '7d',
  generatedAt: '2026-01-08T00:00:00.000Z',
  workspace: {
    activeInstallations: 3,
    totalInstallations: 4,
    executionsInWindow: 12,
    failuresInWindow: 2,
    executionsOverTime: [
      { date: '2026-01-06', count: 5 },
      { date: '2026-01-07', count: 7 },
    ],
    unusedAgents: [{ listingId: 'listing-9', agentId: 'agent-9', name: 'Sleepy agent' }],
    topAgentsByExecutions: [{ agentId: 'agent-1', name: 'Busy agent', runs: 9, failures: 1 }],
  },
  publisher: {
    publishedListings: 2,
    draftListings: 1,
    archivedListings: 0,
    lifetimeInstalls: 4,
    installsInWindow: 2,
    installsOverTime: [
      { date: '2026-01-06', count: 1 },
      { date: '2026-01-07', count: 1 },
    ],
    activeInstalls: 3,
    executionsInWindow: 12,
    adoptionRate: 3,
    averageRating: 4.4,
    perListing: [
      {
        listingId: 'listing-1',
        name: 'Incident Triage Agent',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        installs: 4,
        activeInstalls: 3,
        executions: 12,
        rating: { average: 4.4, count: 2 },
        versionCount: 2,
      },
    ],
    topListings: [],
  },
};
const healthFixture: AgentHealthReportDTO = {
  listingId: 'listing-1',
  name: 'Incident Triage Agent',
  score: 31.3,
  band: 'AT_RISK',
  confidence: 'HIGH',
  runsAnalyzed: 4,
  signals: {
    versionAdoption: 0.5,
    failureRate: 0.75,
    toolErrorRate: 0.5,
    policyViolations: 2,
    reviewTrend: -2,
    recentAverageRating: 2,
  },
};

const recommendationsFixture: MarketplaceRecommendationsDTO = {
  generatedAt: '2026-01-08T00:00:00.000Z',
  featurePolicy: { decision: 'ALLOW', reasonCodes: [] },
  installable: true,
  items: [
    {
      listingId: 'listing-2',
      name: 'Log Classifier',
      description: 'Classifies noisy logs.',
      category: 'Operations',
      tags: ['ops'],
      visibility: 'PUBLIC',
      rating: { average: 4.6, count: 3 },
      installCount: 12,
      versionCount: 2,
      model: 'claude-3-5-sonnet',
      score: 71.5,
      reasons: ['Matches your Operations usage', 'Rated 4.6 by 3 workspace(s)'],
      installable: true,
    },
  ],
  blockedByGovernance: [
    { listingId: 'listing-3', name: 'Blocked agent', model: 'gpt-4o', reasonCodes: ['MODEL_BLOCKED'] },
  ],
};

const lifecycleFixture: MarketplaceLifecycleDTO = {
  generatedAt: '2026-01-08T00:00:00.000Z',
  installer: {
    events: [
      {
        listingId: 'listing-1',
        listingName: 'Incident Triage Agent',
        type: 'UPDATE_AVAILABLE',
        severity: 'INFO',
        message: 'Incident Triage Agent has an update available',
        installedVersion: 1,
        latestVersion: 2,
      },
    ],
  },
  publisher: { events: [], notificationsCreated: 0 },
  summary: {
    totalEvents: 1,
    updates: 1,
    deprecated: 0,
    inactiveAgents: 0,
    archivedListings: 0,
    inactiveListings: 0,
    stalePublications: 0,
    notificationsCreated: 0,
  },
};
describe('Phase 12.8 marketplace intelligence API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests analytics with timeframe and workspace header', async () => {
    client.get.mockResolvedValue({ data: { data: analyticsFixture } });

    const result = await agentMarketplaceApi.getAnalytics('workspace-1', '7d');

    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-marketplace/analytics', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { timeframe: '7d' },
    });
    expect(result.publisher.lifetimeInstalls).toBe(4);
  });

  it('requests health with and without a listing filter', async () => {
    client.get.mockResolvedValue({ data: { data: { generatedAt: 'x', reports: [healthFixture] } } });

    const scoped = await agentMarketplaceApi.getHealth('workspace-1', 'listing-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-marketplace/health', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { listingId: 'listing-1' },
    });
    expect(scoped.reports[0]?.band).toBe('AT_RISK');

    await agentMarketplaceApi.getHealth('workspace-1');
    expect(client.get).toHaveBeenLastCalledWith('/api/v1/agent-marketplace/health', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: {},
    });
  });

  it('requests recommendations with a limit and the lifecycle scan', async () => {
    client.get.mockResolvedValue({ data: { data: recommendationsFixture } });
    const feed = await agentMarketplaceApi.getRecommendations('workspace-1', 5);
    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-marketplace/recommendations', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { limit: 5 },
    });
    expect(feed.blockedByGovernance).toHaveLength(1);

    client.get.mockResolvedValue({ data: { data: lifecycleFixture } });
    const lifecycle = await agentMarketplaceApi.getLifecycle('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-marketplace/lifecycle', workspaceHeaders);
    expect(lifecycle.summary.updates).toBe(1);
  });
});
describe('Phase 12.8 marketplace intelligence components', () => {
  it('renders analytics KPIs, usage insights and time series', () => {
    render(<MarketplaceAnalyticsPanel analytics={analyticsFixture} />);

    expect(screen.getByText('Active installs')).toBeInTheDocument();
    expect(screen.getByText('Adoption')).toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
    expect(screen.getByText('Sleepy agent')).toBeInTheDocument();
    expect(screen.getByText('Busy agent')).toBeInTheDocument();
    expect(screen.getAllByTestId('analytics-bars')).toHaveLength(2);
  });

  it('renders health bands with signal detail', () => {
    render(<AgentHealthIndicator report={healthFixture} showSignals />);

    expect(screen.getByText('AT_RISK')).toBeInTheDocument();
    expect(screen.getByText('31.3')).toBeInTheDocument();
    expect(screen.getByText(/confidence HIGH/)).toBeInTheDocument();
    expect(screen.getByText(/adoption 50%/)).toBeInTheDocument();
  });

  it('renders recommendation reasons and governance exclusions', () => {
    const onInstall = vi.fn();
    render(<RecommendationFeed data={recommendationsFixture} canInstall onInstall={onInstall} />);

    expect(screen.getByText('Log Classifier')).toBeInTheDocument();
    expect(screen.getByText('Matches your Operations usage')).toBeInTheDocument();
    expect(screen.getByText(/1 candidate\(s\) hidden by workspace governance/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledWith('listing-2');
  });

  it('reports governance-disabled recommendations instead of a feed', () => {
    render(
      <RecommendationFeed
        data={{ ...recommendationsFixture, items: [], featurePolicy: { decision: 'DENY', reasonCodes: ['FEATURE_DISABLED'] } }}
        canInstall
        onInstall={vi.fn()}
      />
    );

    expect(screen.getByText(/disabled by workspace governance/)).toBeInTheDocument();
  });

  it('lists lifecycle events with severity badges', () => {
    render(<LifecycleNotifications data={lifecycleFixture} />);

    expect(screen.getByText('Incident Triage Agent')).toBeInTheDocument();
    expect(screen.getByText('UPDATE_AVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('Incident Triage Agent has an update available')).toBeInTheDocument();
  });
});
describe('Phase 12.8 marketplace intelligence routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      currentWorkspace: { _id: 'workspace-1', name: 'Test WS', role: 'OWNER' } as never,
      currentRole: 'OWNER',
    });
  });

  it('renders the marketplace page with discover and intelligence tabs', async () => {
    vi.spyOn(agentMarketplaceApi, 'searchAgents').mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, totalCount: 0, totalPages: 0 },
    });
    vi.spyOn(agentMarketplaceApi, 'getAnalytics').mockResolvedValue(analyticsFixture);
    vi.spyOn(agentMarketplaceApi, 'getRecommendations').mockResolvedValue(recommendationsFixture);
    vi.spyOn(agentMarketplaceApi, 'getLifecycle').mockResolvedValue(lifecycleFixture);
    vi.spyOn(agentMarketplaceApi, 'getHealth').mockResolvedValue({ generatedAt: 'x', reports: [healthFixture] });

    render(<AgentMarketplacePage />);

    expect(screen.getByText('Agent Marketplace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discover' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Intelligence' }));

    await waitFor(() => expect(screen.getByTestId('marketplace-analytics-panel')).toBeInTheDocument());
    expect(await screen.findByTestId('recommendation-feed')).toBeInTheDocument();
    expect(screen.getByTestId('lifecycle-notifications')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-health-indicator').length).toBeGreaterThan(0);
  });

  it('renders the publisher analytics page from the analytics endpoint', async () => {
    const getAnalytics = vi.spyOn(agentMarketplaceApi, 'getAnalytics').mockResolvedValue(analyticsFixture);

    render(<PublisherAnalyticsPage />);

    expect(screen.getByText('Publisher Analytics')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('publisher-analytics-panel')).toBeInTheDocument());
    expect(getAnalytics).toHaveBeenCalledWith('workspace-1', '90d');
    expect(screen.getByText('Incident Triage Agent')).toBeInTheDocument();
    expect(screen.getByText(/4 installs \| 3 active \| 12 runs/)).toBeInTheDocument();
  });
});
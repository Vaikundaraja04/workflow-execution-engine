import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PublisherPortalPage from '@/app/(app)/publisher/page';
import MarketplaceAnalyticsPage from '@/app/(app)/analytics/marketplace/page';
import { marketplaceEcosystemApi } from '@/services/marketplaceEcosystemApi';
import type {
  MarketplaceAnalyticsReportDTO,
  PublisherDashboardDTO,
} from '@/services/marketplaceEcosystemApi';

vi.mock('@/services/marketplaceEcosystemApi', () => ({
  marketplaceEcosystemApi: {
    getPublisherDashboard: vi.fn(),
    getPlatformReport: vi.fn(),
  },
}));
const dashboardFixture: PublisherDashboardDTO = {
  workspaceId: 'ws-publisher',
  window: { days: 30, since: '2026-08-23T00:00:00.000Z' },
  revenue: {
    publisherWorkspaceId: 'ws-publisher',
    totals: {
      transactions: 2,
      grossSales: 5800,
      platformRevenue: 1160,
      publisherEarnings: 4640,
      refunded: 0,
      payouts: 0,
    },
    byCurrency: {
      usd: {
        transactions: 2,
        grossSales: 5800,
        platformRevenue: 1160,
        publisherEarnings: 4640,
        refunded: 0,
        payouts: 0,
      },
    },
    series: [
      { month: '2026-08', transactions: 1, grossSales: 2900, platformRevenue: 580, publisherEarnings: 2320 },
      { month: '2026-09', transactions: 1, grossSales: 2900, platformRevenue: 580, publisherEarnings: 2320 },
    ],
    recent: [
      {
        transactionId: 'mt_recent',
        assetType: 'AGENT',
        assetId: 'asset-1',
        buyerWorkspaceId: 'ws-buyer',
        amount: 2900,
        currency: 'usd',
        publisherEarnings: 2320,
        status: 'AVAILABLE',
        settledAt: '2026-09-20T00:00:00.000Z',
      },
    ],
    generatedAt: '2026-09-22T10:00:00.000Z',
  },  payouts: { available: 4640, paidOut: 0, byCurrency: { usd: { available: 4640, paidOut: 0 } } },
  content: [
    {
      assetType: 'AGENT',
      listingId: 'listing-1',
      assetId: 'asset-1',
      name: 'Incident Response Agent',
      status: 'PUBLISHED',
      pricingModel: 'ONE_TIME_PURCHASE',
      price: 10000,
      currency: 'usd',
      installs: 3,
      sales: 1,
      grossRevenue: 2900,
      rating: { average: 4.5, count: 2 },
    },
    {
      assetType: 'WORKFLOW',
      listingId: 'listing-2',
      assetId: 'template-1',
      name: 'Premium Ops Workflow',
      status: 'PUBLISHED',
      pricingModel: 'SUBSCRIPTION',
      price: 500,
      currency: 'usd',
      installs: 1,
      sales: 1,
      grossRevenue: 2900,
      rating: { average: 4, count: 1 },
    },
  ],
  ratings: { average: 4.3, count: 3 },
  licenses: { active: 2, byAssetType: { AGENT: 1, WORKFLOW: 1 } },
  notes: [],
  generatedAt: '2026-09-22T10:00:00.000Z',
};
const reportFixture: MarketplaceAnalyticsReportDTO = {
  window: { days: 30, since: '2026-08-23T00:00:00.000Z', until: '2026-09-22T00:00:00.000Z' },
  gmv: {
    transactions: 2,
    grossSales: 5800,
    platformRevenue: 1160,
    publisherEarnings: 4640,
    refunded: 0,
    payouts: 0,
    netGrossSales: 5800,
    byCurrency: {
      usd: {
        transactions: 2,
        grossSales: 5800,
        platformRevenue: 1160,
        publisherEarnings: 4640,
        refunded: 0,
        payouts: 0,
      },
    },
  },
  licenses: { active: 2, byAssetType: { AGENT: 1, WORKFLOW: 1 } },
  adoption: {
    agentListings: 4,
    workflowListings: 3,
    agentInstalls: 5,
    workflowInstalls: 2,
    publishers: 2,
    activeLicenseHolders: 2,
  },
  topAssets: [
    {
      assetType: 'AGENT',
      assetId: 'asset-1',
      name: 'Incident Response Agent',
      sales: 1,
      grossSales: 2900,
      publisherEarnings: 2320,
    },
  ],
  publisherGrowth: [
    { month: '2026-09', newPublishers: 2, activePublishers: 2, grossSales: 5800, transactions: 2 },
  ],
  notes: [],
  generatedAt: '2026-09-22T10:00:00.000Z',
};
describe('Phase 17 marketplace revenue views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(marketplaceEcosystemApi.getPublisherDashboard).mockResolvedValue(dashboardFixture);
    vi.mocked(marketplaceEcosystemApi.getPlatformReport).mockResolvedValue(reportFixture);
  });

  it('renders the publisher portal from the dashboard payload', async () => {
    render(<PublisherPortalPage />);

    expect(await screen.findByText('Publisher portal')).toBeInTheDocument();
    expect(await screen.findByText('Publisher overview')).toBeInTheDocument();
    expect(await screen.findByText('Sales analytics')).toBeInTheDocument();
    expect(screen.getByText('Revenue trend')).toBeInTheDocument();
    expect(screen.getByText('Content manager')).toBeInTheDocument();
    expect(screen.getByText('$58')).toBeInTheDocument();
    expect(screen.getByText('$12')).toBeInTheDocument();
    expect(screen.getAllByText('$46')).toHaveLength(2);
    expect(screen.getAllByText('$29')).toHaveLength(4);
    expect(screen.getByText('2 (1 agents, 1 workflows)')).toBeInTheDocument();
    expect(screen.getByText('4.3 from 3 review(s)')).toBeInTheDocument();

    expect(screen.getByText('Incident Response Agent')).toBeInTheDocument();
    expect(screen.getByText('Premium Ops Workflow')).toBeInTheDocument();
    expect(screen.getByText('ONE_TIME_PURCHASE · $100')).toBeInTheDocument();
    expect(screen.getByText('SUBSCRIPTION · $5')).toBeInTheDocument();
    expect(screen.getByText(/mt_recent/)).toBeInTheDocument();
  });
  it('reloads the dashboard when the window changes', async () => {
    render(<PublisherPortalPage />);
    await screen.findByText('Publisher portal');
    await waitFor(() => {
      expect(marketplaceEcosystemApi.getPublisherDashboard).toHaveBeenCalledWith(30);
    });

    await userEvent.selectOptions(screen.getByLabelText('Window'), 'Last 90 days');

    await waitFor(() => {
      expect(marketplaceEcosystemApi.getPublisherDashboard).toHaveBeenCalledWith(90);
    });
  });

  it('renders the platform marketplace analytics from the report payload', async () => {
    render(<MarketplaceAnalyticsPage />);

    expect(await screen.findByText('Marketplace analytics')).toBeInTheDocument();
    expect(await screen.findByText('Ecosystem GMV')).toBeInTheDocument();
    expect(await screen.findByText('Adoption and top assets')).toBeInTheDocument();
    expect(screen.getByText('Publisher growth')).toBeInTheDocument();

    expect(screen.getAllByText('$58')).toHaveLength(3);
    expect(screen.getByText('$12')).toBeInTheDocument();
    expect(screen.getByText('$46')).toBeInTheDocument();
    expect(screen.getByText('Incident Response Agent')).toBeInTheDocument();
    expect(screen.getByText('2026-09')).toBeInTheDocument();
    expect(marketplaceEcosystemApi.getPlatformReport).toHaveBeenCalledWith({ days: 30 });
  });
  it('reports an empty marketplace with explicit notes instead of estimates', async () => {
    const emptyDashboard: PublisherDashboardDTO = {
      ...dashboardFixture,
      revenue: {
        ...dashboardFixture.revenue,
        totals: { transactions: 0, grossSales: 0, platformRevenue: 0, publisherEarnings: 0, refunded: 0, payouts: 0 },
        byCurrency: {},
        series: [],
        recent: [],
      },
      payouts: { available: 0, paidOut: 0, byCurrency: {} },
      content: [],
      ratings: { average: 0, count: 0 },
      licenses: { active: 0, byAssetType: { AGENT: 0, WORKFLOW: 0 } },
      notes: ['No marketplace listings published by this workspace', 'No sales recorded in this window'],
    };
    vi.mocked(marketplaceEcosystemApi.getPublisherDashboard).mockResolvedValue(emptyDashboard);

    render(<PublisherPortalPage />);

    expect(await screen.findByText('No marketplace listings yet')).toBeInTheDocument();
    expect(screen.getByText('No sales recorded in this window')).toBeInTheDocument();
    expect(screen.getByText('No marketplace listings published by this workspace')).toBeInTheDocument();
    expect(screen.getByText('No settlements to chart yet.')).toBeInTheDocument();
    expect(screen.getByText('No reviews recorded yet')).toBeInTheDocument();
  });

  it('surfaces API failures for both views', async () => {
    vi.mocked(marketplaceEcosystemApi.getPublisherDashboard).mockRejectedValue({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace was not found',
      status: 404,
    });
    vi.mocked(marketplaceEcosystemApi.getPlatformReport).mockRejectedValue({
      code: 'FORBIDDEN',
      message: 'Insufficient permission for this action',
      status: 403,
    });

    render(<PublisherPortalPage />);
    expect(await screen.findByText('Could not load the publisher dashboard')).toBeInTheDocument();
    expect(screen.getByText('Workspace was not found')).toBeInTheDocument();

    render(<MarketplaceAnalyticsPage />);
    expect(await screen.findByText('Could not load marketplace analytics')).toBeInTheDocument();
    expect(screen.getByText('Insufficient permission for this action')).toBeInTheDocument();
  });
});
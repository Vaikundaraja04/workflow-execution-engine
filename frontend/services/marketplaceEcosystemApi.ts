import { apiClient } from './apiClient';

/**
 * Phase 17 - Marketplace ecosystem client.
 *
 * Backs /publisher with the Phase 17.4 publisher portal (content, revenue,
 * licenses, ratings and payouts for the calling workspace) and
 * /analytics/marketplace with the Phase 17.8 platform report (GMV, adoption,
 * top assets and publisher growth). Every figure is folded by the backend from
 * recorded transactions and licenses - the client never recomputes revenue.
 */

export interface MarketplaceRevenueTotalsDTO {
  transactions: number;
  grossSales: number;
  platformRevenue: number;
  publisherEarnings: number;
  refunded: number;
  payouts: number;
}

export interface PublisherRevenueSeriesPointDTO {
  month: string;
  transactions: number;
  grossSales: number;
  platformRevenue: number;
  publisherEarnings: number;
}

export interface PublisherRecentSaleDTO {
  transactionId: string;
  assetType: string;
  assetId: string;
  buyerWorkspaceId: string;
  amount: number;
  currency: string;
  publisherEarnings: number;
  status: string;
  settledAt: string;
}

export interface PublisherRevenueReportDTO {
  publisherWorkspaceId: string;
  totals: MarketplaceRevenueTotalsDTO;
  byCurrency: Record<string, MarketplaceRevenueTotalsDTO>;
  series: PublisherRevenueSeriesPointDTO[];
  recent: PublisherRecentSaleDTO[];
  generatedAt: string;
}

export interface PublisherContentItemDTO {
  assetType: 'AGENT' | 'WORKFLOW';
  listingId: string;
  assetId: string;
  name: string;
  status: string;
  pricingModel: string | null;
  price: number | null;
  currency: string | null;
  installs: number;
  sales: number;
  grossRevenue: number;
  rating: { average: number; count: number };
}

export interface PublisherDashboardDTO {
  workspaceId: string;
  window: { days: number; since: string };
  revenue: PublisherRevenueReportDTO;
  payouts: {
    available: number;
    paidOut: number;
    byCurrency: Record<string, { available: number; paidOut: number }>;
  };
  content: PublisherContentItemDTO[];
  ratings: { average: number; count: number };
  licenses: { active: number; byAssetType: { AGENT: number; WORKFLOW: number } };
  notes: string[];
  generatedAt: string;
}
export interface MarketplaceAnalyticsReportDTO {
  window: { days: number; since: string; until: string };
  gmv: MarketplaceRevenueTotalsDTO & {
    netGrossSales: number;
    byCurrency: Record<string, MarketplaceRevenueTotalsDTO>;
  };
  licenses: { active: number; byAssetType: Record<string, number> };
  adoption: {
    agentListings: number;
    workflowListings: number;
    agentInstalls: number;
    workflowInstalls: number;
    publishers: number;
    activeLicenseHolders: number;
  };
  topAssets: Array<{
    assetType: string;
    assetId: string;
    name: string;
    sales: number;
    grossSales: number;
    publisherEarnings: number;
  }>;
  publisherGrowth: Array<{
    month: string;
    newPublishers: number;
    activePublishers: number;
    grossSales: number;
    transactions: number;
  }>;
  notes: string[];
  generatedAt: string;
}

export const marketplaceEcosystemApi = {
  getPublisherDashboard: async (days: number = 30): Promise<PublisherDashboardDTO> => {
    const response = await apiClient.get<{ data: PublisherDashboardDTO }>(
      '/api/v1/marketplace/publisher/dashboard',
      { params: { days } },
    );
    return response.data.data;
  },
  getPlatformReport: async (
    options: { days?: number; months?: number } = {},
  ): Promise<MarketplaceAnalyticsReportDTO> => {
    const response = await apiClient.get<{ data: MarketplaceAnalyticsReportDTO }>(
      '/api/v1/analytics/marketplace',
      { params: { days: options.days ?? 30, months: options.months ?? 6 } },
    );
    return response.data.data;
  },
};

export default marketplaceEcosystemApi;
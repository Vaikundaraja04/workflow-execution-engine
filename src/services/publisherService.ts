import { Types } from 'mongoose';
import { AgentMarketplaceModel } from '../models/AgentMarketplaceModel.js';
import { MarketplacePricingModel } from '../models/MarketplacePricingModel.js';
import { MarketplaceLicenseModel } from '../models/MarketplaceLicenseModel.js';
import { RevenueTransactionModel } from '../models/RevenueTransactionModel.js';
import { marketplaceRevenueService } from './marketplaceRevenueService.js';
import { workflowMarketplaceService } from './workflowMarketplaceService.js';

/**
 * Phase 17.4 - Publisher portal.
 *
 * One dashboard for a publishing workspace: the listings it owns with their
 * pricing and install state, the revenue folded from the 17.3 ledger, licenses
 * sold and ratings from published reviews. Everything is scoped to the caller
 * workspace as the seller - a member of another workspace sees only their own
 * portfolio, and an empty portfolio reports zeros with an explicit note.
 */

export interface PublisherContentItem {
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

const MAX_LISTINGS = 200;
const MAX_TRANSACTION_ROWS = 5000;

export class PublisherService {
  /** Publisher-scoped portfolio: content, sales, revenue, ratings and licenses. */
  async getDashboard(workspaceId: string, options: { days?: number | undefined } = {}) {
    const workspace = new Types.ObjectId(workspaceId);
    const days = Number.isFinite(options.days) && options.days && options.days > 0 ? Math.min(365, Math.floor(options.days)) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [revenue, workflowListings, agentRows] = await Promise.all([
      marketplaceRevenueService.publisherRevenue(workspaceId, { days }),
      workflowMarketplaceService.listPublisherListings(workspaceId),
      AgentMarketplaceModel.find({ workspaceId: workspace })
        .select('name status installCount rating publisherId')
        .limit(MAX_LISTINGS)
        .lean(),
    ]);

    const agentIds = agentRows.map((row) => row._id);
    const [pricingRows, assetRevenue] = await Promise.all([
      agentIds.length > 0
        ? MarketplacePricingModel.find({ assetType: 'AGENT', assetId: { $in: agentIds } }).lean()
        : [],
      RevenueTransactionModel.aggregate<{
        _id: { assetType: string; assetId: Types.ObjectId };
        sales: number;
        grossRevenue: number;
      }>([
        { $match: { sellerWorkspaceId: workspace, settledAt: { $gte: since } } },
        {
          $group: {
            _id: { assetType: '$assetType', assetId: '$assetId' },
            sales: { $sum: 1 },
            grossRevenue: { $sum: '$amount' },
          },
        },
      ]),
    ]);

    const pricingByAsset = new Map(pricingRows.map((row) => [row.assetId.toString(), row]));
    const revenueByAsset = new Map(assetRevenue.map((row) => [row._id.assetId.toString(), row]));
    const content: PublisherContentItem[] = agentRows.map((row) => {
      const pricing = pricingByAsset.get(row._id.toString());
      const earned = revenueByAsset.get(row._id.toString());
      return {
        assetType: 'AGENT' as const,
        listingId: row._id.toString(),
        assetId: row._id.toString(),
        name: row.name,
        status: row.status,
        pricingModel: pricing ? pricing.pricingModel : null,
        price: pricing ? pricing.price : null,
        currency: pricing ? pricing.currency : null,
        installs: row.installCount ?? 0,
        sales: earned ? earned.sales : 0,
        grossRevenue: earned ? earned.grossRevenue : 0,
        rating: { average: row.rating?.average ?? 0, count: row.rating?.count ?? 0 },
      };
    });
    for (const listing of workflowListings) {
      content.push({
        assetType: 'WORKFLOW',
        listingId: listing.listingId,
        assetId: listing.templateId,
        name: listing.name,
        status: listing.status,
        pricingModel: listing.pricingModel,
        price: listing.price,
        currency: listing.currency,
        installs: listing.statistics.installs,
        sales: listing.statistics.sales,
        grossRevenue: listing.statistics.grossRevenue,
        rating: listing.rating,
      });
    }
    const publisherIds = new Set<string>();
    for (const row of agentRows) publisherIds.add(row.publisherId.toString());
    for (const listing of workflowListings) publisherIds.add(listing.publisherId);
    const publisherObjectIds = [...publisherIds].map((id) => new Types.ObjectId(id));

    const [activeLicenses, agentLicenses, workflowLicenses] = await Promise.all([
      MarketplaceLicenseModel.countDocuments({ publisherId: { $in: publisherObjectIds }, status: 'ACTIVE' }),
      MarketplaceLicenseModel.countDocuments({ publisherId: { $in: publisherObjectIds }, status: 'ACTIVE', assetType: 'AGENT' }),
      MarketplaceLicenseModel.countDocuments({ publisherId: { $in: publisherObjectIds }, status: 'ACTIVE', assetType: 'WORKFLOW' }),
    ]);

    const ratingCount = content.reduce((sum, item) => sum + item.rating.count, 0);
    const ratingWeighted = content.reduce((sum, item) => sum + item.rating.average * item.rating.count, 0);

    const notes: string[] = [];
    if (content.length === 0) notes.push('No marketplace listings published by this workspace');
    if (content.length > 0 && content.every((item) => item.status !== 'PUBLISHED')) {
      notes.push('No published listings - drafts and archived listings are not sellable');
    }
    if (revenue.totals.transactions === 0) notes.push('No sales recorded in this window');
    const payoutsByCurrency: Record<string, { available: number; paidOut: number }> = {};
    for (const [currency, totals] of Object.entries(revenue.byCurrency)) {
      payoutsByCurrency[currency] = {
        available: Math.max(0, totals.publisherEarnings - totals.payouts),
        paidOut: totals.payouts,
      };
    }

    return {
      workspaceId,
      window: { days, since: since.toISOString() },
      revenue,
      payouts: {
        available: Math.max(0, revenue.totals.publisherEarnings - revenue.totals.payouts),
        paidOut: revenue.totals.payouts,
        byCurrency: payoutsByCurrency,
      },
      content,
      ratings: {
        average: ratingCount > 0 ? Math.round((ratingWeighted / ratingCount) * 10) / 10 : 0,
        count: ratingCount,
      },
      licenses: { active: activeLicenses, byAssetType: { AGENT: agentLicenses, WORKFLOW: workflowLicenses } },
      notes,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const publisherService = new PublisherService();

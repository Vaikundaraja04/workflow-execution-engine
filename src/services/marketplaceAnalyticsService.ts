import { Types } from 'mongoose';
import { RevenueTransactionModel } from '../models/RevenueTransactionModel.js';
import { MarketplaceLicenseModel } from '../models/MarketplaceLicenseModel.js';
import { AgentMarketplaceModel } from '../models/AgentMarketplaceModel.js';
import { InstalledAgentModel } from '../models/InstalledAgentModel.js';
import { WorkflowTemplateMarketplaceModel } from '../models/WorkflowTemplateMarketplaceModel.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 17.8 - Ecosystem analytics.
 *
 * GMV, commission, top assets, publisher growth and adoption folded from the
 * Phase 17.3 revenue ledger and the license records. Every figure is recorded
 * data - a window without transactions reports zeros plus an explicit note,
 * never an estimate.
 */

interface Totals {
  transactions: number;
  grossSales: number;
  platformRevenue: number;
  publisherEarnings: number;
  refunded: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

function emptyTotals(): Totals {
  return { transactions: 0, grossSales: 0, platformRevenue: 0, publisherEarnings: 0, refunded: 0 };
}

export interface MarketplaceAnalyticsOverview {
  window: { days: number; since: string; until: string };
  gmv: Totals & { netGrossSales: number; byCurrency: Record<string, Totals> };
  licenses: {
    active: number;
    byAssetType: Record<string, number>;
  };
  adoption: {
    agentListings: number;
    workflowListings: number;
    agentInstalls: number;
    workflowInstalls: number;
    publishers: number;
    activeLicenseHolders: number;
  };
  notes: string[];
  generatedAt: string;
}
export class MarketplaceAnalyticsService {
  private resolveWindow(days: number | undefined): { days: number; since: Date; until: Date } {
    const safeDays = Number.isFinite(days) && days && days > 0 ? Math.min(365, Math.floor(days)) : 30;
    const until = new Date();
    return { days: safeDays, since: new Date(until.getTime() - safeDays * DAY_MS), until };
  }

  /** GMV, commission, licenses and adoption for one window. */
  async overview(options: { days?: number | undefined } = {}): Promise<MarketplaceAnalyticsOverview> {
    const window = this.resolveWindow(options.days);
    const rows = await RevenueTransactionModel.find({ settledAt: { $gte: window.since, $lte: window.until } })
      .limit(MAX_ROWS)
      .lean();

    const gmv = emptyTotals();
    const byCurrency: Record<string, Totals> = {};
    for (const row of rows) {
      const net = Math.max(0, row.amount - row.refundedAmount);
      const share = row.amount > 0 ? net / row.amount : 0;
      const bucket = byCurrency[row.currency] ?? emptyTotals();
      for (const target of [gmv, bucket]) {
        target.transactions += 1;
        target.grossSales += row.amount;
        target.platformRevenue += Math.round(row.platformCommission * share);
        target.publisherEarnings += Math.round(row.publisherEarnings * share);
        target.refunded += row.refundedAmount;
      }
      byCurrency[row.currency] = bucket;
    }
    const [activeLicenses, agentLicenses, workflowLicenses, agentListings, workflowListings, agentInstalls, workflowInstalls, publishers, holders] = await Promise.all([
      MarketplaceLicenseModel.countDocuments({ status: 'ACTIVE' }),
      MarketplaceLicenseModel.countDocuments({ status: 'ACTIVE', assetType: 'AGENT' }),
      MarketplaceLicenseModel.countDocuments({ status: 'ACTIVE', assetType: 'WORKFLOW' }),
      AgentMarketplaceModel.countDocuments({ status: 'PUBLISHED' }),
      WorkflowTemplateMarketplaceModel.countDocuments({ status: 'PUBLISHED' }),
      InstalledAgentModel.countDocuments({ status: 'ACTIVE' }),
      WorkflowTemplateMarketplaceModel.aggregate<{ installs: number }>([
        { $group: { _id: null, installs: { $sum: '$statistics.installs' } } },
      ]),
      AgentMarketplaceModel.distinct('workspaceId', { status: 'PUBLISHED' }),
      MarketplaceLicenseModel.distinct('workspaceId', { status: 'ACTIVE' }),
    ]);

    const notes: string[] = [];
    if (gmv.transactions === 0) notes.push('No marketplace transactions recorded in this window');
    if (activeLicenses === 0) notes.push('No active marketplace licenses recorded');
    if (agentListings === 0 && workflowListings === 0) notes.push('No published marketplace listings recorded');

    return {
      window: { days: window.days, since: window.since.toISOString(), until: window.until.toISOString() },
      gmv: {
        ...gmv,
        netGrossSales: Math.max(0, gmv.grossSales - gmv.refunded),
        byCurrency,
      },
      licenses: {
        active: activeLicenses,
        byAssetType: { AGENT: agentLicenses, WORKFLOW: workflowLicenses },
      },
      adoption: {
        agentListings,
        workflowListings,
        agentInstalls,
        workflowInstalls: workflowInstalls[0]?.installs ?? 0,
        publishers: publishers.length,
        activeLicenseHolders: holders.length,
      },
      notes,
      generatedAt: new Date().toISOString(),
    };
  }
  /** Best selling assets from recorded transactions in one window. */
  async topAssets(options: { days?: number | undefined; limit?: number | undefined } = {}) {
    const window = this.resolveWindow(options.days);
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0 ? Math.min(50, Math.floor(options.limit)) : 10;
    const rows = await RevenueTransactionModel.aggregate<{
      _id: { assetType: string; assetId: Types.ObjectId };
      sales: number;
      grossSales: number;
      publisherEarnings: number;
    }>([
      { $match: { settledAt: { $gte: window.since, $lte: window.until } } },
      {
        $group: {
          _id: { assetType: '$assetType', assetId: '$assetId' },
          sales: { $sum: 1 },
          grossSales: { $sum: '$amount' },
          publisherEarnings: { $sum: '$publisherEarnings' },
        },
      },
      { $sort: { grossSales: -1 } },
      { $limit: limit },
    ]);

    const agentIds = rows.filter((row) => row._id.assetType === 'AGENT').map((row) => row._id.assetId);
    const templateIds = rows.filter((row) => row._id.assetType === 'WORKFLOW').map((row) => row._id.assetId);
    const [agents, templates] = await Promise.all([
      agentIds.length > 0 ? AgentMarketplaceModel.find({ _id: { $in: agentIds } }).select('name').lean() : [],
      templateIds.length > 0 ? WorkflowTemplateModel.find({ _id: { $in: templateIds } }).select('name').lean() : [],
    ]);
    const names = new Map<string, string>();
    for (const agent of agents) names.set(agent._id.toString(), agent.name);
    for (const template of templates) names.set(template._id.toString(), template.name as string);

    return {
      window: { days: window.days, since: window.since.toISOString(), until: window.until.toISOString() },
      items: rows.map((row) => ({
        assetType: row._id.assetType,
        assetId: row._id.assetId.toString(),
        name: names.get(row._id.assetId.toString()) ?? 'Unknown asset',
        sales: row.sales,
        grossSales: row.grossSales,
        publisherEarnings: row.publisherEarnings,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
  /** New and active publishers per month, folded from the ledger. */
  async publisherGrowth(options: { months?: number | undefined } = {}) {
    const months = Number.isFinite(options.months) && options.months && options.months > 0 ? Math.min(24, Math.floor(options.months)) : 6;
    const until = new Date();
    const since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() - (months - 1), 1));
    const rows = await RevenueTransactionModel.find({ settledAt: { $gte: since, $lte: until } })
      .select('sellerWorkspaceId settledAt amount')
      .limit(MAX_ROWS)
      .lean();

    const firstSales = await RevenueTransactionModel.aggregate<{ _id: Types.ObjectId; first: Date }>([
      { $group: { _id: '$sellerWorkspaceId', first: { $min: '$settledAt' } } },
    ]);
    const firstMonth = new Map(firstSales.map((row) => [row._id.toString(), row.first.toISOString().slice(0, 7)]));

    const buckets = new Map<string, { month: string; newPublishers: number; active: Set<string>; grossSales: number; transactions: number }>();
    for (let index = 0; index < months; index += 1) {
      const key = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + index, 1)).toISOString().slice(0, 7);
      buckets.set(key, { month: key, newPublishers: 0, active: new Set(), grossSales: 0, transactions: 0 });
    }
    for (const row of rows) {
      const bucket = buckets.get(row.settledAt.toISOString().slice(0, 7));
      if (!bucket) continue;
      bucket.active.add(row.sellerWorkspaceId.toString());
      bucket.grossSales += row.amount;
      bucket.transactions += 1;
    }
    for (const month of firstMonth.values()) {
      const bucket = buckets.get(month);
      if (bucket) bucket.newPublishers += 1;
    }

    return {
      window: { months, since: since.toISOString() },
      series: [...buckets.values()].map((bucket) => ({
        month: bucket.month,
        newPublishers: bucket.newPublishers,
        activePublishers: bucket.active.size,
        grossSales: bucket.grossSales,
        transactions: bucket.transactions,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
  /** Full ecosystem report for the platform analytics route (audited). */
  async report(options: { days?: number | undefined; months?: number | undefined; limit?: number | undefined; actorUserId?: string | undefined } = {}) {
    const [overview, topAssets, publisherGrowth] = await Promise.all([
      this.overview({ days: options.days }),
      this.topAssets({ days: options.days, limit: options.limit }),
      this.publisherGrowth({ months: options.months }),
    ]);

    await createAuditLog({
      action: 'MARKETPLACE_ANALYTICS_VIEWED',
      ...(options.actorUserId !== undefined ? { userId: options.actorUserId } : {}),
      resource: 'marketplace_analytics',
      resourceId: 'ecosystem',
      metadata: { days: overview.window.days, months: publisherGrowth.window.months, topAssets: topAssets.items.length },
    });

    return {
      ...overview,
      topAssets: topAssets.items,
      publisherGrowth: publisherGrowth.series,
    };
  }
}

export const marketplaceAnalyticsService = new MarketplaceAnalyticsService();

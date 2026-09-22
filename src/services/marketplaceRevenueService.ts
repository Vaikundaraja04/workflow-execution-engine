import { Types } from 'mongoose';
import { RevenueTransactionModel, splitRevenue } from '../models/RevenueTransactionModel.js';
import type { RevenueTransactionStatus } from '../models/RevenueTransactionModel.js';
import { MarketplaceLicenseModel } from '../models/MarketplaceLicenseModel.js';
import type { MarketplaceAssetType } from '../models/MarketplacePricingModel.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 17.3 - Marketplace revenue engine.
 *
 * One ledger for every settled marketplace payment: gross sales, platform
 * commission, publisher earnings, refunds and payout batches. Every number is
 * folded from recorded transactions - a refund is recorded against the original
 * row, never fabricated, and net figures always subtract it.
 */

export interface RecordTransactionInput {
  buyerWorkspaceId: string;
  sellerWorkspaceId: string;
  publisherId: string;
  assetType: MarketplaceAssetType;
  assetId: string;
  amount: number;
  currency: string;
  revenueSharePercentage: number;
  paymentId?: string | null | undefined;
  provider?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RevenueTotals {
  transactions: number;
  grossSales: number;
  platformRevenue: number;
  publisherEarnings: number;
  refunded: number;
  payouts: number;
}

export interface RevenueSummary {
  totals: RevenueTotals;
  byCurrency: Record<string, RevenueTotals>;
  generatedAt: string;
}

export interface RevenueSeriesPoint {
  month: string;
  transactions: number;
  grossSales: number;
  platformRevenue: number;
  publisherEarnings: number;
}

export interface PublisherRevenueReport extends RevenueSummary {
  publisherWorkspaceId: string;
  series: RevenueSeriesPoint[];
  recent: Array<{
    transactionId: string;
    assetType: string;
    assetId: string;
    buyerWorkspaceId: string;
    amount: number;
    currency: string;
    publisherEarnings: number;
    status: string;
    settledAt: string;
  }>;
}

export interface PlatformRevenueReport extends RevenueSummary {
  byAssetType: Array<{ assetType: string; transactions: number; grossSales: number; platformRevenue: number }>;
  topSellers: Array<{ sellerWorkspaceId: string; grossSales: number; publisherEarnings: number; transactions: number }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

function emptyTotals(): RevenueTotals {
  return { transactions: 0, grossSales: 0, platformRevenue: 0, publisherEarnings: 0, refunded: 0, payouts: 0 };
}

export class MarketplaceRevenueService {
  /** One append-only ledger row per settled payment. */
  async recordTransaction(input: RecordTransactionInput) {
    const split = splitRevenue(input.amount, input.revenueSharePercentage);
    return RevenueTransactionModel.create({
      transactionId: `mt_${new Types.ObjectId().toHexString()}`,
      buyerWorkspaceId: new Types.ObjectId(input.buyerWorkspaceId),
      sellerWorkspaceId: new Types.ObjectId(input.sellerWorkspaceId),
      publisherId: new Types.ObjectId(input.publisherId),
      assetType: input.assetType,
      assetId: new Types.ObjectId(input.assetId),
      paymentId: input.paymentId ?? null,
      provider: input.provider ?? null,
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      platformCommission: split.platformCommission,
      publisherEarnings: split.publisherEarnings,
      revenueSharePercentage: input.revenueSharePercentage,
      status: 'AVAILABLE',
      refundedAmount: 0,
      settledAt: new Date(),
      metadata: input.metadata,
    });
  }

  async listTransactions(filters: {
    sellerWorkspaceId?: string | undefined;
    buyerWorkspaceId?: string | undefined;
    status?: RevenueTransactionStatus | undefined;
    limit?: number | undefined;
  } = {}) {
    const query: Record<string, unknown> = {};
    if (filters.sellerWorkspaceId && Types.ObjectId.isValid(filters.sellerWorkspaceId)) {
      query.sellerWorkspaceId = new Types.ObjectId(filters.sellerWorkspaceId);
    }
    if (filters.buyerWorkspaceId && Types.ObjectId.isValid(filters.buyerWorkspaceId)) {
      query.buyerWorkspaceId = new Types.ObjectId(filters.buyerWorkspaceId);
    }
    if (filters.status) query.status = filters.status;
    const limit = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0
      ? Math.min(200, Math.floor(filters.limit))
      : 50;
    return RevenueTransactionModel.find(query).sort({ settledAt: -1 }).limit(limit).lean();
  }

  private fold(rows: Array<{
    amount: number;
    currency: string;
    platformCommission: number;
    publisherEarnings: number;
    refundedAmount: number;
    status: string;
  }>): RevenueSummary {
    const totals = emptyTotals();
    const byCurrency: Record<string, RevenueTotals> = {};
    for (const row of rows) {
      const bucket = byCurrency[row.currency] ?? emptyTotals();
      const net = Math.max(0, row.amount - row.refundedAmount);
      const share = row.amount > 0 ? net / row.amount : 0;
      const platform = Math.round(row.platformCommission * share);
      const publisher = Math.round(row.publisherEarnings * share);
      for (const target of [totals, bucket]) {
        target.transactions += 1;
        target.grossSales += row.amount;
        target.platformRevenue += platform;
        target.publisherEarnings += publisher;
        target.refunded += row.refundedAmount;
        if (row.status === 'PAID_OUT') target.payouts += publisher;
      }
      byCurrency[row.currency] = bucket;
    }
    return { totals, byCurrency, generatedAt: new Date().toISOString() };
  }

  /** Publisher-facing revenue: totals, monthly series and the latest sales. */
  async publisherRevenue(
    sellerWorkspaceId: string,
    options: { days?: number | undefined; now?: Date | undefined } = {},
  ): Promise<PublisherRevenueReport> {
    const seller = new Types.ObjectId(sellerWorkspaceId);
    const days = Number.isFinite(options.days) && options.days && options.days > 0 ? Math.min(365, Math.floor(options.days)) : 30;
    const now = options.now ?? new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const rows = await RevenueTransactionModel.find({
      sellerWorkspaceId: seller,
      settledAt: { $gte: since, $lte: now },
    }).sort({ settledAt: -1 }).limit(MAX_ROWS).lean();
    const summary = this.fold(rows);

    const seriesMap = new Map<string, RevenueSeriesPoint>();
    for (const row of rows) {
      const month = row.settledAt.toISOString().slice(0, 7);
      const point = seriesMap.get(month) ?? { month, transactions: 0, grossSales: 0, platformRevenue: 0, publisherEarnings: 0 };
      const net = Math.max(0, row.amount - row.refundedAmount);
      const share = row.amount > 0 ? net / row.amount : 0;
      point.transactions += 1;
      point.grossSales += row.amount;
      point.platformRevenue += Math.round(row.platformCommission * share);
      point.publisherEarnings += Math.round(row.publisherEarnings * share);
      seriesMap.set(month, point);
    }

    return {
      publisherWorkspaceId: sellerWorkspaceId,
      ...summary,
      series: [...seriesMap.values()].sort((left, right) => left.month.localeCompare(right.month)),
      recent: rows.slice(0, 10).map((row) => ({
        transactionId: row.transactionId,
        assetType: row.assetType,
        assetId: row.assetId.toString(),
        buyerWorkspaceId: row.buyerWorkspaceId.toString(),
        amount: row.amount,
        currency: row.currency,
        publisherEarnings: row.publisherEarnings,
        status: row.status,
        settledAt: row.settledAt.toISOString(),
      })),
    };
  }

  /** Platform-facing revenue: totals, asset mix and the best-selling publishers. */
  async platformRevenue(options: { days?: number | undefined; now?: Date | undefined } = {}): Promise<PlatformRevenueReport> {
    const days = Number.isFinite(options.days) && options.days && options.days > 0 ? Math.min(365, Math.floor(options.days)) : 30;
    const now = options.now ?? new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const rows = await RevenueTransactionModel.find({ settledAt: { $gte: since, $lte: now } })
      .sort({ settledAt: -1 })
      .limit(MAX_ROWS)
      .lean();
    const summary = this.fold(rows);

    const assetMix = new Map<string, { assetType: string; transactions: number; grossSales: number; platformRevenue: number }>();
    const sellers = new Map<string, { sellerWorkspaceId: string; grossSales: number; publisherEarnings: number; transactions: number }>();
    for (const row of rows) {
      const asset = assetMix.get(row.assetType) ?? { assetType: row.assetType, transactions: 0, grossSales: 0, platformRevenue: 0 };
      const net = Math.max(0, row.amount - row.refundedAmount);
      const share = row.amount > 0 ? net / row.amount : 0;
      asset.transactions += 1;
      asset.grossSales += row.amount;
      asset.platformRevenue += Math.round(row.platformCommission * share);
      assetMix.set(row.assetType, asset);

      const sellerKey = row.sellerWorkspaceId.toString();
      const seller = sellers.get(sellerKey) ?? { sellerWorkspaceId: sellerKey, grossSales: 0, publisherEarnings: 0, transactions: 0 };
      seller.transactions += 1;
      seller.grossSales += row.amount;
      seller.publisherEarnings += Math.round(row.publisherEarnings * share);
      sellers.set(sellerKey, seller);
    }

    return {
      ...summary,
      byAssetType: [...assetMix.values()].sort((left, right) => right.grossSales - left.grossSales),
      topSellers: [...sellers.values()].sort((left, right) => right.grossSales - left.grossSales).slice(0, 10),
    };
  }

  async refundTransaction(
    transactionId: string,
    input: { amount?: number | undefined; reason?: string | undefined } = {},
    actorUserId?: string | undefined,
  ) {
    const row = await RevenueTransactionModel.findOne({ transactionId });
    if (!row) throw new Error('TRANSACTION_NOT_FOUND');
    if (row.status === 'REFUNDED') throw new Error('TRANSACTION_ALREADY_REFUNDED');
    const remaining = Math.max(0, row.amount - row.refundedAmount);
    const amount = Number.isFinite(input.amount) && input.amount && input.amount > 0
      ? Math.min(Math.floor(input.amount), remaining)
      : remaining;
    if (amount <= 0) throw new Error('INVALID_REFUND_AMOUNT');

    row.refundedAmount += amount;
    row.refundedAt = new Date();
    const fullyRefunded = row.refundedAmount >= row.amount;
    if (fullyRefunded) row.status = 'REFUNDED';
    await row.save();

    if (fullyRefunded) {
      await MarketplaceLicenseModel.updateOne(
        { workspaceId: row.buyerWorkspaceId, assetType: row.assetType, assetId: row.assetId, status: 'ACTIVE' },
        {
          $set: {
            status: 'REVOKED',
            revokedAt: new Date(),
            ...(actorUserId ? { revokedBy: new Types.ObjectId(actorUserId) } : {}),
            revokeReason: input.reason ?? 'Payment refunded',
          },
        },
      );
    }

    await createAuditLog({
      action: 'MARKETPLACE_REFUND_RECORDED',
      ...(actorUserId !== undefined ? { userId: actorUserId } : {}),
      workspaceId: row.sellerWorkspaceId,
      resource: 'revenue_transaction',
      resourceId: row.transactionId,
      metadata: { amount, currency: row.currency, fullyRefunded, reason: input.reason ?? null },
    });

    return {
      transactionId: row.transactionId,
      amount,
      refundedAmount: row.refundedAmount,
      status: row.status,
      currency: row.currency,
      fullyRefunded,
    };
  }

  /** Mark every AVAILABLE transaction for a seller as paid out in one batch. */
  async recordPayout(sellerWorkspaceId: string, actorUserId?: string | undefined) {
    const seller = new Types.ObjectId(sellerWorkspaceId);
    const available = await RevenueTransactionModel.find({ sellerWorkspaceId: seller, status: 'AVAILABLE' });
    if (available.length === 0) throw new Error('NO_AVAILABLE_BALANCE');
    const payoutId = `po_${new Types.ObjectId().toHexString()}`;
    let amount = 0;
    for (const row of available) {
      const net = Math.max(0, row.amount - row.refundedAmount);
      const share = row.amount > 0 ? net / row.amount : 0;
      amount += Math.round(row.publisherEarnings * share);
      row.status = 'PAID_OUT';
      row.payoutId = payoutId;
      await row.save();
    }

    await createAuditLog({
      action: 'MARKETPLACE_PAYOUT_RECORDED',
      ...(actorUserId !== undefined ? { userId: actorUserId } : {}),
      workspaceId: seller,
      resource: 'marketplace_payout',
      resourceId: payoutId,
      metadata: { transactions: available.length, amount },
    });

    return { payoutId, transactions: available.length, amount };
  }
}

export const marketplaceRevenueService = new MarketplaceRevenueService();

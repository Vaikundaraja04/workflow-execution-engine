import mongoose, { Schema, Types } from 'mongoose';
import { MARKETPLACE_ASSET_TYPES } from './MarketplacePricingModel.js';
import type { MarketplaceAssetType } from './MarketplacePricingModel.js';

/**
 * Phase 17.3 - Marketplace revenue ledger.
 *
 * One append-only row per settled marketplace payment: gross amount, platform
 * commission, publisher earnings and the payout state. Every figure is derived
 * from the amount actually received from the provider - nothing is projected.
 */

export const REVENUE_TRANSACTION_STATUSES = [
  'PENDING',
  'AVAILABLE',
  'PAID_OUT',
  'REFUNDED',
  'REVERSED',
] as const;
export type RevenueTransactionStatus = (typeof REVENUE_TRANSACTION_STATUSES)[number];

export const DEFAULT_PLATFORM_COMMISSION_PERCENT = 20;

export interface IRevenueTransaction {
  transactionId: string;
  buyerWorkspaceId: Types.ObjectId;
  sellerWorkspaceId: Types.ObjectId;
  publisherId: Types.ObjectId;
  assetType: MarketplaceAssetType;
  assetId: Types.ObjectId;
  paymentId: string | null;
  provider: string | null;
  amount: number;
  currency: string;
  platformCommission: number;
  publisherEarnings: number;
  revenueSharePercentage: number;
  status: RevenueTransactionStatus;
  refundedAmount: number;
  refundedAt: Date | null;
  payoutId: string | null;
  settledAt: Date;
  metadata?: Record<string, unknown> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const RevenueTransactionSchema = new Schema<IRevenueTransaction>({
  transactionId: { type: String, required: true, unique: true, maxlength: 64 },
  buyerWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  sellerWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  publisherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assetType: { type: String, enum: [...MARKETPLACE_ASSET_TYPES], required: true },
  assetId: { type: Schema.Types.ObjectId, required: true },
  paymentId: { type: String, default: null, maxlength: 191 },
  provider: { type: String, default: null, maxlength: 32 },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: 'usd', maxlength: 8 },
  platformCommission: { type: Number, required: true, min: 0 },
  publisherEarnings: { type: Number, required: true, min: 0 },
  revenueSharePercentage: { type: Number, required: true, min: 0, max: 100 },
  status: { type: String, enum: [...REVENUE_TRANSACTION_STATUSES], required: true, default: 'PENDING' },
  refundedAmount: { type: Number, required: true, min: 0, default: 0 },
  refundedAt: { type: Date, default: null },
  payoutId: { type: String, default: null, maxlength: 64 },
  settledAt: { type: Date, required: true, default: Date.now },
  metadata: { type: Schema.Types.Mixed, default: undefined },
}, { timestamps: true, minimize: false });

RevenueTransactionSchema.index({ buyerWorkspaceId: 1, createdAt: -1 });
RevenueTransactionSchema.index({ sellerWorkspaceId: 1, status: 1 });
RevenueTransactionSchema.index({ assetType: 1, assetId: 1, createdAt: -1 });
RevenueTransactionSchema.index({ status: 1, createdAt: -1 });

export const RevenueTransactionModel = mongoose.model<IRevenueTransaction>('RevenueTransaction', RevenueTransactionSchema);

/** Split a settled amount into the platform commission and publisher earnings. */
export function splitRevenue(amount: number, publisherSharePercent: number): { platformCommission: number; publisherEarnings: number } {
  const share = Math.max(0, Math.min(100, publisherSharePercent));
  const publisherEarnings = Math.round((amount * share) / 100);
  return { platformCommission: amount - publisherEarnings, publisherEarnings };
}

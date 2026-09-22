import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 17.1 - Marketplace pricing.
 *
 * The commerce record for a sellable asset: pricing model, price, billing cycle
 * and the publisher share of every settled payment. Listings, installs and
 * definitions stay in the agent (12.7) and workflow (17.2) marketplaces - this
 * collection only answers "what does it cost and who earns what".
 */

export const MARKETPLACE_ASSET_TYPES = ['AGENT', 'WORKFLOW'] as const;
export type MarketplaceAssetType = (typeof MARKETPLACE_ASSET_TYPES)[number];

export const MARKETPLACE_PRICING_MODELS = [
  'FREE',
  'ONE_TIME_PURCHASE',
  'SUBSCRIPTION',
  'ENTERPRISE_LICENSE',
] as const;
export type MarketplacePricingModel = (typeof MARKETPLACE_PRICING_MODELS)[number];

export const MARKETPLACE_BILLING_CYCLES = ['NONE', 'MONTHLY', 'YEARLY'] as const;
export type MarketplaceBillingCycle = (typeof MARKETPLACE_BILLING_CYCLES)[number];

export const MARKETPLACE_PRICING_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type MarketplacePricingStatus = (typeof MARKETPLACE_PRICING_STATUSES)[number];

export const DEFAULT_PUBLISHER_SHARE_PERCENT = 80;

export interface IMarketplacePricing {
  workspaceId: Types.ObjectId;
  assetType: MarketplaceAssetType;
  assetId: Types.ObjectId;
  publisherId: Types.ObjectId;
  pricingModel: MarketplacePricingModel;
  price: number;
  currency: string;
  billingCycle: MarketplaceBillingCycle;
  revenueSharePercentage: number;
  seats: number | null;
  termMonths: number | null;
  status: MarketplacePricingStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MarketplacePricingSchema = new Schema<IMarketplacePricing>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  assetType: { type: String, enum: [...MARKETPLACE_ASSET_TYPES], required: true },
  assetId: { type: Schema.Types.ObjectId, required: true },
  publisherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  pricingModel: { type: String, enum: [...MARKETPLACE_PRICING_MODELS], required: true, default: 'FREE' },
  price: { type: Number, required: true, min: 0, default: 0 },
  currency: { type: String, required: true, default: 'usd', maxlength: 8 },
  billingCycle: { type: String, enum: [...MARKETPLACE_BILLING_CYCLES], required: true, default: 'NONE' },
  revenueSharePercentage: { type: Number, required: true, min: 0, max: 100, default: DEFAULT_PUBLISHER_SHARE_PERCENT },
  seats: { type: Number, default: null, min: 1 },
  termMonths: { type: Number, default: null, min: 1 },
  status: { type: String, enum: [...MARKETPLACE_PRICING_STATUSES], required: true, default: 'DRAFT' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, minimize: false });

MarketplacePricingSchema.index({ assetType: 1, assetId: 1 }, { unique: true });
MarketplacePricingSchema.index({ publisherId: 1, status: 1 });
MarketplacePricingSchema.index({ status: 1, pricingModel: 1 });

export const MarketplacePricingModel = mongoose.model<IMarketplacePricing>('MarketplacePricing', MarketplacePricingSchema);

export function isMarketplacePricingModel(value: unknown): value is MarketplacePricingModel {
  return typeof value === 'string' && (MARKETPLACE_PRICING_MODELS as readonly string[]).includes(value);
}

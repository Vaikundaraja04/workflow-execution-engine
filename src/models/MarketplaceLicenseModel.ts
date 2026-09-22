import mongoose, { Schema, Types } from 'mongoose';
import { MARKETPLACE_ASSET_TYPES } from './MarketplacePricingModel.js';
import type { MarketplaceAssetType, MarketplacePricingModel } from './MarketplacePricingModel.js';

/**
 * Phase 17.1 - Marketplace licenses.
 *
 * The commercial entitlement for one purchased asset inside one workspace.
 * Installs (InstalledAgentModel, workflow installs) stay the technical state;
 * this record is what guarantees the purchase: who bought what, when it
 * expires, and the payment and revenue transaction that settled it.
 */

export const LICENSE_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export interface IMarketplaceLicense {
  workspaceId: Types.ObjectId;
  assetType: MarketplaceAssetType;
  assetId: Types.ObjectId;
  publisherId: Types.ObjectId;
  pricingModel: MarketplacePricingModel;
  status: LicenseStatus;
  seats: number | null;
  paymentId: string | null;
  provider: string | null;
  transactionId: string | null;
  revenueSharePercentage: number;
  activatedAt: Date;
  expiresAt: Date | null;
  lastRenewedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: Types.ObjectId | null;
  revokeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MarketplaceLicenseSchema = new Schema<IMarketplaceLicense>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  assetType: { type: String, enum: [...MARKETPLACE_ASSET_TYPES], required: true },
  assetId: { type: Schema.Types.ObjectId, required: true },
  publisherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  pricingModel: { type: String, required: true },
  status: { type: String, enum: [...LICENSE_STATUSES], required: true, default: 'ACTIVE' },
  seats: { type: Number, default: null, min: 1 },
  paymentId: { type: String, default: null, maxlength: 191 },
  provider: { type: String, default: null, maxlength: 32 },
  transactionId: { type: String, default: null, maxlength: 64 },
  revenueSharePercentage: { type: Number, required: true, min: 0, max: 100, default: 80 },
  activatedAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date, default: null },
  lastRenewedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  revokeReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, minimize: false });

MarketplaceLicenseSchema.index({ workspaceId: 1, assetType: 1, assetId: 1 }, { unique: true });
MarketplaceLicenseSchema.index({ publisherId: 1, status: 1 });
MarketplaceLicenseSchema.index({ status: 1, expiresAt: 1 });
MarketplaceLicenseSchema.index({ workspaceId: 1, status: 1 });

export const MarketplaceLicenseModel = mongoose.model<IMarketplaceLicense>('MarketplaceLicense', MarketplaceLicenseSchema);

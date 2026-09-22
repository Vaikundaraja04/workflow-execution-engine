import mongoose, { Schema, Types } from 'mongoose';
import { MARKETPLACE_ASSET_TYPES } from './MarketplacePricingModel.js';
import type { MarketplaceAssetType } from './MarketplacePricingModel.js';

/**
 * Phase 17.7 - Marketplace reviews and trust.
 *
 * One review per workspace per asset, allowed only after a verified purchase or
 * an active license. Abuse protection: repeat reports hide a review (audited),
 * hiding is reversible by platform administrators, and the reviewer identity is
 * never exposed beyond the workspace id.
 */

export const REVIEW_STATUSES = ['PUBLISHED', 'HIDDEN'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_ABUSE_REPORT_THRESHOLD = 3;

export interface IMarketplaceReview {
  assetType: MarketplaceAssetType;
  assetId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  publisherId: Types.ObjectId;
  rating: number;
  review: string | null;
  verifiedPurchase: boolean;
  status: ReviewStatus;
  abuseReports: Types.ObjectId[];
  hiddenReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MarketplaceReviewSchema = new Schema<IMarketplaceReview>({
  assetType: { type: String, enum: [...MARKETPLACE_ASSET_TYPES], required: true },
  assetId: { type: Schema.Types.ObjectId, required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  publisherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  review: { type: String, default: null, maxlength: 2000 },
  verifiedPurchase: { type: Boolean, required: true, default: false },
  status: { type: String, enum: [...REVIEW_STATUSES], required: true, default: 'PUBLISHED' },
  abuseReports: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
  hiddenReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, minimize: false });

MarketplaceReviewSchema.index({ assetType: 1, assetId: 1, workspaceId: 1 }, { unique: true });
MarketplaceReviewSchema.index({ assetId: 1, status: 1, createdAt: -1 });
MarketplaceReviewSchema.index({ publisherId: 1, status: 1 });

export const MarketplaceReviewModel = mongoose.model<IMarketplaceReview>('MarketplaceReview', MarketplaceReviewSchema);

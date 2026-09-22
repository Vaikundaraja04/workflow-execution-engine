import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 17.6 - Partner marketplace listings.
 *
 * What a partner (16.6) offers the ecosystem: a packaged solution, consulting
 * engagement or agency service. A partner listing never grants workspace access
 * and never bypasses the platform marketplaces - published solutions reference
 * existing templates or solutions instead of copying them.
 */

export const PARTNER_LISTING_TYPES = ['SOLUTION', 'CONSULTING', 'AGENCY'] as const;
export type PartnerListingType = (typeof PARTNER_LISTING_TYPES)[number];

export const PARTNER_LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PartnerListingStatus = (typeof PARTNER_LISTING_STATUSES)[number];

export interface IPartnerMarketplace {
  partnerId: Types.ObjectId;
  workspaceId: Types.ObjectId | null;
  listingType: PartnerListingType;
  title: string;
  description: string;
  templateId: Types.ObjectId | null;
  solutionId: string | null;
  industryTags: string[];
  commissionRatePercent: number;
  status: PartnerListingStatus;
  statistics: {
    referrals: number;
    customers: number;
    commissionEarned: number;
  };
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerMarketplaceSchema = new Schema<IPartnerMarketplace>({
  partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  listingType: { type: String, enum: [...PARTNER_LISTING_TYPES], required: true, default: 'SOLUTION' },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 4000 },
  templateId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', default: null },
  solutionId: { type: String, default: null, maxlength: 64 },
  industryTags: { type: [String], default: [] },
  commissionRatePercent: { type: Number, required: true, min: 0, max: 50, default: 20 },
  status: { type: String, enum: [...PARTNER_LISTING_STATUSES], required: true, default: 'DRAFT' },
  statistics: {
    referrals: { type: Number, default: 0, min: 0 },
    customers: { type: Number, default: 0, min: 0 },
    commissionEarned: { type: Number, default: 0, min: 0 },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, minimize: false });

PartnerMarketplaceSchema.index({ partnerId: 1, status: 1 });
PartnerMarketplaceSchema.index({ status: 1, listingType: 1 });
PartnerMarketplaceSchema.index({ industryTags: 1 });

export const PartnerMarketplaceModel = mongoose.model<IPartnerMarketplace>('PartnerMarketplace', PartnerMarketplaceSchema);

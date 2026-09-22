import mongoose, { Schema, Types } from 'mongoose';
import { MARKETPLACE_BILLING_CYCLES, MARKETPLACE_PRICING_MODELS, DEFAULT_PUBLISHER_SHARE_PERCENT } from './MarketplacePricingModel.js';
import type { MarketplaceBillingCycle, MarketplacePricingModel } from './MarketplacePricingModel.js';

/**
 * Phase 17.2 - Premium workflow marketplace.
 *
 * The commerce record for a workflow template: what it costs, how it is
 * packaged (premium workflow, industry solution or bundle) and how it sells.
 * The template definition, versions and installs stay in WorkflowTemplateModel
 * and templateService - this collection never duplicates a workflow.
 */

export const WORKFLOW_LISTING_TYPES = ['PREMIUM_WORKFLOW', 'INDUSTRY_SOLUTION', 'BUNDLE'] as const;
export type WorkflowListingType = (typeof WORKFLOW_LISTING_TYPES)[number];

export const WORKFLOW_LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type WorkflowListingStatus = (typeof WORKFLOW_LISTING_STATUSES)[number];

export interface IWorkflowTemplateMarketplace {
  templateId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  publisherId: Types.ObjectId;
  listingType: WorkflowListingType;
  pricingModel: MarketplacePricingModel;
  price: number;
  currency: string;
  billingCycle: MarketplaceBillingCycle;
  revenueSharePercentage: number;
  bundleTemplateIds: Types.ObjectId[];
  industryTags: string[];
  status: WorkflowListingStatus;
  marketplaceVersion: number;
  statistics: {
    sales: number;
    installs: number;
    grossRevenue: number;
  };
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowTemplateMarketplaceSchema = new Schema<IWorkflowTemplateMarketplace>({
  templateId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', required: true, unique: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  publisherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  listingType: { type: String, enum: [...WORKFLOW_LISTING_TYPES], required: true, default: 'PREMIUM_WORKFLOW' },
  pricingModel: { type: String, enum: [...MARKETPLACE_PRICING_MODELS], required: true, default: 'FREE' },
  price: { type: Number, required: true, min: 0, default: 0 },
  currency: { type: String, required: true, default: 'usd', maxlength: 8 },
  billingCycle: { type: String, enum: [...MARKETPLACE_BILLING_CYCLES], required: true, default: 'NONE' },
  revenueSharePercentage: { type: Number, required: true, min: 0, max: 100, default: DEFAULT_PUBLISHER_SHARE_PERCENT },
  bundleTemplateIds: { type: [Schema.Types.ObjectId], ref: 'WorkflowTemplate', default: [] },
  industryTags: { type: [String], default: [] },
  status: { type: String, enum: [...WORKFLOW_LISTING_STATUSES], required: true, default: 'DRAFT' },
  marketplaceVersion: { type: Number, required: true, min: 1, default: 1 },
  statistics: {
    sales: { type: Number, default: 0, min: 0 },
    installs: { type: Number, default: 0, min: 0 },
    grossRevenue: { type: Number, default: 0, min: 0 },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, minimize: false });

WorkflowTemplateMarketplaceSchema.index({ status: 1, listingType: 1 });
WorkflowTemplateMarketplaceSchema.index({ publisherId: 1, status: 1 });
WorkflowTemplateMarketplaceSchema.index({ industryTags: 1 });
WorkflowTemplateMarketplaceSchema.index({ 'statistics.sales': -1 });

export const WorkflowTemplateMarketplaceModel = mongoose.model<IWorkflowTemplateMarketplace>(
  'WorkflowTemplateMarketplace',
  WorkflowTemplateMarketplaceSchema,
);

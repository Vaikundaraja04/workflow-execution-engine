import mongoose, { Schema, Document, Types } from 'mongoose';

export const TEMPLATE_CATEGORIES = [
  'Automation',
  'Data Processing',
  'Integration',
  'AI Workflow',
  'Approval Flow',
  'Monitoring',
  'Notifications',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_VISIBILITY = [
  'PRIVATE',
  'WORKSPACE',
  'PUBLIC',
  'MARKETPLACE',
] as const;

export type TemplateVisibility = (typeof TEMPLATE_VISIBILITY)[number];

export const TEMPLATE_STATUS = [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
] as const;

export type TemplateStatus = (typeof TEMPLATE_STATUS)[number];

export const MARKETPLACE_STATUS = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

export type MarketplaceStatus = (typeof MARKETPLACE_STATUS)[number];

export interface IWorkflowTemplate extends Document<Types.ObjectId> {
  name: string;
  description: string;
  category: string;
  visibility: TemplateVisibility;
  status: TemplateStatus;
  marketplaceStatus?: MarketplaceStatus | undefined;
  workspaceId?: Types.ObjectId | undefined; // null/undefined for PUBLIC/MARKETPLACE templates
  createdBy: Types.ObjectId;
  publisherId?: Types.ObjectId | undefined; // user or organization that published it
  workflowDefinition: any; // JSON structure of the workflow
  latestVersion?: Types.ObjectId | undefined; // reference to TemplateVersion
  versionCount: number;
  tags: string[];
  metadata: {
    icon?: string | undefined;
    documentation?: string | undefined;
    requirements?: string[] | undefined;
    variables?: Record<string, any> | undefined;
  };
  statistics: {
    downloads: number;
    installs: number;
    executions: number;
  };
  rating: {
    average: number;
    count: number;
  };
  ratingsList?: Array<{
    userId: Types.ObjectId;
    rating: number;
    review?: string | undefined;
    createdAt: Date;
  }> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowTemplateSchema = new Schema<IWorkflowTemplate>({
  name: { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 500 },
  category: { type: String, required: true, maxlength: 50 },
  visibility: { type: String, enum: TEMPLATE_VISIBILITY, required: true },
  status: { type: String, enum: TEMPLATE_STATUS, required: true, default: 'DRAFT' },
  marketplaceStatus: { type: String, enum: MARKETPLACE_STATUS, default: 'DRAFT' },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  publisherId: { type: Schema.Types.ObjectId, ref: 'User' },
  workflowDefinition: { type: Schema.Types.Mixed, required: true },
  latestVersion: { type: Schema.Types.ObjectId, ref: 'TemplateVersion' },
  versionCount: { type: Number, default: 0 },
  tags: [{ type: String, maxlength: 30 }],
  metadata: {
    icon: { type: String },
    documentation: { type: String },
    requirements: [{ type: String }],
    variables: { type: Schema.Types.Mixed },
  },
  statistics: {
    downloads: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    executions: { type: Number, default: 0 },
  },
  rating: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
  },
  ratingsList: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true, minimize: false });

// Indexes
WorkflowTemplateSchema.index({ visibility: 1, category: 1 });
WorkflowTemplateSchema.index({ createdBy: 1 });
WorkflowTemplateSchema.index({ tags: 1 });
WorkflowTemplateSchema.index({ createdAt: -1 });
WorkflowTemplateSchema.index({ 'statistics.downloads': -1 });
WorkflowTemplateSchema.index({ 'rating.average': -1 });
WorkflowTemplateSchema.index({ name: 'text', description: 'text', tags: 'text' });

export const WorkflowTemplateModel = mongoose.model<IWorkflowTemplate>('WorkflowTemplate', WorkflowTemplateSchema);
import mongoose, { Schema, Document, Types } from 'mongoose';

export const AGENT_MARKETPLACE_VISIBILITIES = ['PUBLIC', 'PRIVATE', 'WORKSPACE'] as const;
export type AgentMarketplaceVisibility = (typeof AGENT_MARKETPLACE_VISIBILITIES)[number];

export const AGENT_MARKETPLACE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type AgentMarketplaceStatus = (typeof AGENT_MARKETPLACE_STATUSES)[number];

export const AGENT_MARKETPLACE_CATEGORIES = [
  'Automation',
  'Data Processing',
  'Integration',
  'AI Workflow',
  'Approval Flow',
  'Monitoring',
  'Notifications',
  'Operations',
  'Security',
] as const;

export type AgentMarketplaceCategory = (typeof AGENT_MARKETPLACE_CATEGORIES)[number];

export const AGENT_PRICING_MODELS = ['FREE', 'PAID'] as const;
export type AgentPricingModel = (typeof AGENT_PRICING_MODELS)[number];

export interface IAgentDefinitionSnapshot {
  name: string;
  description?: string;
  systemPrompt: string;
  modelConfig: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxTurns?: number;
  };
  orchestrationMode: string;
  toolsAllowed: string[];
  requiredPermissions: string[];
  memoryEnabled: boolean;
}

export interface IAgentMarketplace extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  agentId: Types.ObjectId;
  publisherId: Types.ObjectId;
  name: string;
  description: string;
  category: string;
  tags: string[];
  visibility: AgentMarketplaceVisibility;
  status: AgentMarketplaceStatus;
  icon?: string;
  documentation?: string;
  pricing: {
    model: AgentPricingModel;
    priceUSD: number;
    currency: string;
  };
  statistics: {
    views: number;
    installs: number;
    executions: number;
    downloads: number;
  };
  installCount: number;
  executionCount: number;
  rating: {
    average: number;
    count: number;
  };
  agentSnapshot?: IAgentDefinitionSnapshot;
  latestVersion?: Types.ObjectId;
  versionCount: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const AgentMarketplaceSchema = new Schema<IAgentMarketplace>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
  publisherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 2000 },
  category: { type: String, default: 'Automation', maxlength: 50 },
  tags: { type: [String], default: [] },
  visibility: { type: String, enum: [...AGENT_MARKETPLACE_VISIBILITIES], default: 'WORKSPACE' },
  status: { type: String, enum: [...AGENT_MARKETPLACE_STATUSES], default: 'DRAFT', index: true },
  icon: { type: String, maxlength: 200 },
  documentation: { type: String, maxlength: 8000 },
  pricing: {
    model: { type: String, enum: [...AGENT_PRICING_MODELS], default: 'FREE' },
    priceUSD: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD', maxlength: 8 },
  },
  statistics: {
    views: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    executions: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
  },
  installCount: { type: Number, default: 0 },
  executionCount: { type: Number, default: 0 },
  rating: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0, min: 0 },
  },
  agentSnapshot: { type: Schema.Types.Mixed },
  latestVersion: { type: Schema.Types.ObjectId, ref: 'AgentVersion' },
  versionCount: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, minimize: false });

AgentMarketplaceSchema.index({ workspaceId: 1, agentId: 1 }, { unique: true });
AgentMarketplaceSchema.index({ workspaceId: 1, status: 1 });
AgentMarketplaceSchema.index({ status: 1, visibility: 1, category: 1 });
AgentMarketplaceSchema.index({ tags: 1 });
AgentMarketplaceSchema.index({ 'rating.average': -1 });
AgentMarketplaceSchema.index({ installCount: -1 });
AgentMarketplaceSchema.index({ name: 'text', description: 'text', tags: 'text' });

export const AgentMarketplaceModel = mongoose.model<IAgentMarketplace>(
  'AgentMarketplace',
  AgentMarketplaceSchema,
);
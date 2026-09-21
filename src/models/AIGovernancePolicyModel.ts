import mongoose, { Schema, Document, Types } from 'mongoose';
import type { WorkspaceRole } from './WorkspaceMemberModel.js';

export const AI_GOVERNANCE_POLICY_TYPES = [
  'MODEL_ACCESS',
  'FEATURE',
  'PROMPT',
  'PRIVACY',
  'USAGE_LIMIT',
  'APPROVAL',
  'AGENT_TOOL',
] as const;

export type AIGovernancePolicyType = (typeof AI_GOVERNANCE_POLICY_TYPES)[number];

export const AI_GOVERNANCE_FEATURES = [
  'AI_WORKFLOW_CREATE',
  'AI_ANALYSIS',
  'AI_OPTIMIZATION',
  'AI_AGENT',
] as const;

export type AIGovernanceFeature = (typeof AI_GOVERNANCE_FEATURES)[number];

export const GOVERNANCE_POLICY_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type GovernancePolicyStatus = (typeof GOVERNANCE_POLICY_STATUSES)[number];

export const GOVERNANCE_ACTION_ON_EXCEEDED = ['THROTTLE', 'BLOCK'] as const;
export type GovernanceActionOnExceeded = (typeof GOVERNANCE_ACTION_ON_EXCEEDED)[number];

export const GOVERNANCE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type GovernanceSeverity = (typeof GOVERNANCE_SEVERITIES)[number];

export const PII_DATA_CLASSES = [
  'email',
  'phone',
  'ssn',
  'creditCard',
  'apiKey',
  'bearerToken',
  'privateKey',
  'password',
] as const;

export type PIIDataClass = (typeof PII_DATA_CLASSES)[number];
export interface IAIModelAccessPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  allowedModels: string[];
  blockedModels: string[];
  allowedRoles: WorkspaceRole[];
  status: GovernancePolicyStatus;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AIModelAccessPolicySchema = new Schema<IAIModelAccessPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  allowedModels: { type: [String], default: [] },
  blockedModels: { type: [String], default: [] },
  allowedRoles: { type: [String], default: [] },
  status: { type: String, enum: GOVERNANCE_POLICY_STATUSES, default: 'ACTIVE' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

AIModelAccessPolicySchema.index({ workspaceId: 1, status: 1 });

export const AIModelAccessPolicyModel = mongoose.model<IAIModelAccessPolicy>(
  'AIModelAccessPolicy',
  AIModelAccessPolicySchema,
);

export interface IAIFeaturePolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  feature: AIGovernanceFeature;
  allowedRoles: WorkspaceRole[];
  enabled: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AIFeaturePolicySchema = new Schema<IAIFeaturePolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  feature: { type: String, enum: AI_GOVERNANCE_FEATURES, required: true },
  allowedRoles: { type: [String], default: [] },
  enabled: { type: Boolean, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

AIFeaturePolicySchema.index({ workspaceId: 1, feature: 1 }, { unique: true });

export const AIFeaturePolicyModel = mongoose.model<IAIFeaturePolicy>(
  'AIFeaturePolicy',
  AIFeaturePolicySchema,
);
export interface IAIPromptPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  blockedPatterns: string[];
  requiredApprovalPatterns: string[];
  severity: GovernanceSeverity;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AIPromptPolicySchema = new Schema<IAIPromptPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  blockedPatterns: { type: [String], default: [] },
  requiredApprovalPatterns: { type: [String], default: [] },
  severity: { type: String, enum: GOVERNANCE_SEVERITIES, default: 'MEDIUM' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const AIPromptPolicyModel = mongoose.model<IAIPromptPolicy>(
  'AIPromptPolicy',
  AIPromptPolicySchema,
);

export interface IPIIRedactionRule {
  dataClass: PIIDataClass;
  action: 'REDACT' | 'BLOCK';
  pattern?: string;
}

export interface IAIPrivacyPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  allowedDataClasses: PIIDataClass[];
  redactionRules: IPIIRedactionRule[];
  blockSensitiveData: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AIPrivacyPolicySchema = new Schema<IAIPrivacyPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  allowedDataClasses: { type: [String], enum: PII_DATA_CLASSES, default: [] },
  redactionRules: { type: Schema.Types.Mixed, default: [] },
  blockSensitiveData: { type: Boolean, default: false },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const AIPrivacyPolicyModel = mongoose.model<IAIPrivacyPolicy>(
  'AIPrivacyPolicy',
  AIPrivacyPolicySchema,
);
export interface IAIUsageLimitPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyCostLimit: number;
  monthlyCostLimit: number;
  actionOnExceeded: GovernanceActionOnExceeded;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AIUsageLimitPolicySchema = new Schema<IAIUsageLimitPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  dailyTokenLimit: { type: Number, default: 0, min: 0 },
  monthlyTokenLimit: { type: Number, default: 0, min: 0 },
  dailyCostLimit: { type: Number, default: 0, min: 0 },
  monthlyCostLimit: { type: Number, default: 0, min: 0 },
  actionOnExceeded: { type: String, enum: GOVERNANCE_ACTION_ON_EXCEEDED, default: 'THROTTLE' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const AIUsageLimitPolicyModel = mongoose.model<IAIUsageLimitPolicy>(
  'AIUsageLimitPolicy',
  AIUsageLimitPolicySchema,
);

export interface IAIApprovalConditions {
  premiumModel: boolean;
  highCost: boolean;
  riskLevel: boolean;
  sensitivePrompt: boolean;
}

export interface IAIApprovalPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  conditions: IAIApprovalConditions;
  highCostThresholdUSD: number;
  requiredApproverRole: WorkspaceRole;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AIApprovalPolicySchema = new Schema<IAIApprovalPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  conditions: {
    premiumModel: { type: Boolean, default: false },
    highCost: { type: Boolean, default: false },
    riskLevel: { type: Boolean, default: false },
    sensitivePrompt: { type: Boolean, default: false },
  },
  highCostThresholdUSD: { type: Number, default: 1, min: 0 },
  requiredApproverRole: { type: String, enum: ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'], default: 'ADMIN' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const AIApprovalPolicyModel = mongoose.model<IAIApprovalPolicy>(
  'AIApprovalPolicy',
  AIApprovalPolicySchema,
);
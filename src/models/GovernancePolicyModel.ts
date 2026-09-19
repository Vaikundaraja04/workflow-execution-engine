import { Schema, model, Document, Types } from 'mongoose';

export interface IApprovalRule {
  workflowTypes?: string[] | undefined;
  requiredRoles?: string[] | undefined;
  minApprovers?: number | undefined;
  requireApprovalForPublish?: boolean | undefined;
  requireApprovalForExecution?: boolean | undefined;
}

export interface IExecutionPolicy {
  maxConcurrentExecutions?: number | undefined;
  maxExecutionTimeSeconds?: number | undefined;
  allowedNodeTypes?: string[] | undefined;
  forbiddenNodeTypes?: string[] | undefined;
  rateLimitPerMinute?: number | undefined;
}

export interface ISecurityPolicy {
  requireMFA?: boolean | undefined;
  allowedIPRanges?: string[] | undefined;
  sessionTimeoutMinutes?: number | undefined;
  requireSecretEncryption?: boolean | undefined;
}

export interface IComplianceRule {
  dataResidency?: string[] | undefined;
  encryptionAtRest?: boolean | undefined;
  auditLogRetentionDays?: number | undefined;
  gdprCompliant?: boolean | undefined;
}

export interface IGovernancePolicy extends Document {
  workspaceId?: Types.ObjectId | undefined;
  name: string;
  description: string;
  approvalRules: IApprovalRule;
  executionPolicies: IExecutionPolicy;
  securityPolicies: ISecurityPolicy;
  complianceRules: IComplianceRule;
  isActive: boolean;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const GovernancePolicySchema = new Schema<IGovernancePolicy>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    approvalRules: {
      workflowTypes: { type: [String], default: [] },
      requiredRoles: { type: [String], default: ['OWNER', 'ADMIN'] },
      minApprovers: { type: Number, default: 1 },
      requireApprovalForPublish: { type: Boolean, default: false },
      requireApprovalForExecution: { type: Boolean, default: false },
    },
    executionPolicies: {
      maxConcurrentExecutions: { type: Number, default: 100 },
      maxExecutionTimeSeconds: { type: Number, default: 3600 },
      allowedNodeTypes: { type: [String], default: [] },
      forbiddenNodeTypes: { type: [String], default: [] },
      rateLimitPerMinute: { type: Number, default: 600 },
    },
    securityPolicies: {
      requireMFA: { type: Boolean, default: false },
      allowedIPRanges: { type: [String], default: [] },
      sessionTimeoutMinutes: { type: Number, default: 1440 },
      requireSecretEncryption: { type: Boolean, default: true },
    },
    complianceRules: {
      dataResidency: { type: [String], default: ['US', 'EU'] },
      encryptionAtRest: { type: Boolean, default: true },
      auditLogRetentionDays: { type: Number, default: 365 },
      gdprCompliant: { type: Boolean, default: true },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

GovernancePolicySchema.index({ workspaceId: 1, isActive: 1 });

export const GovernancePolicyModel = model<IGovernancePolicy>('GovernancePolicy', GovernancePolicySchema);

// Approval Request Model
export interface IGovernanceApproval extends Document {
  workspaceId: Types.ObjectId;
  policyId?: Types.ObjectId | undefined;
  workflowId?: Types.ObjectId | undefined;
  requestType: 'WORKFLOW_PUBLISH' | 'WORKFLOW_EXECUTION' | 'POLICY_CHANGE' | 'DEPLOYMENT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedBy: Types.ObjectId;
  reviewedBy?: Types.ObjectId | undefined;
  comments?: string | undefined;
  reason?: string | undefined;
  metadata?: Record<string, any> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const GovernanceApprovalSchema = new Schema<IGovernanceApproval>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    policyId: {
      type: Schema.Types.ObjectId,
      ref: 'GovernancePolicy',
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'Workflow',
      index: true,
    },
    requestType: {
      type: String,
      enum: ['WORKFLOW_PUBLISH', 'WORKFLOW_EXECUTION', 'POLICY_CHANGE', 'DEPLOYMENT'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    comments: { type: String, maxlength: 1000 },
    reason: { type: String, maxlength: 1000 },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

GovernanceApprovalSchema.index({ workspaceId: 1, status: 1 });

export const GovernanceApprovalModel = model<IGovernanceApproval>('GovernanceApproval', GovernanceApprovalSchema);
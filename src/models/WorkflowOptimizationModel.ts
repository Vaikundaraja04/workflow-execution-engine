import mongoose, { Schema, Document, Types } from 'mongoose';

export const OPTIMIZATION_TYPES = [
  'PERFORMANCE_OPTIMIZATION',
  'COST_OPTIMIZATION',
  'RELIABILITY_OPTIMIZATION',
  'ARCHITECTURE_OPTIMIZATION',
  'SECURITY_OPTIMIZATION',
  'MIXED',
] as const;

export type OptimizationType = (typeof OPTIMIZATION_TYPES)[number];

export const OPTIMIZATION_PLAN_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'FAILED'] as const;

export type OptimizationPlanStatus = (typeof OPTIMIZATION_PLAN_STATUSES)[number];

export const OPTIMIZATION_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type OptimizationRiskLevel = (typeof OPTIMIZATION_RISK_LEVELS)[number];

export interface OptimizationNodeConfigChange {
  kind: 'UPDATE_NODE_CONFIG';
  nodeId: string;
  config: Record<string, unknown>;
}

export interface OptimizationEdgeChange {
  kind: 'ADD_EDGE' | 'REMOVE_EDGE';
  edge: { source: string; target: string; condition?: 'true' | 'false' };
}

export interface OptimizationNodeAddition {
  kind: 'ADD_NODE';
  node: { id: string; type: string; config: Record<string, unknown> };
}

export type OptimizationChange =
  | OptimizationNodeConfigChange
  | OptimizationEdgeChange
  | OptimizationNodeAddition;

export interface OptimizationRecommendation {
  id: string;
  type: Exclude<OptimizationType, 'MIXED'>;
  title: string;
  description: string;
  expectedImprovement: {
    metric: string;
    value: number;
    unit: 'percent' | 'ms' | 'usd' | 'count';
    description: string;
  };
  confidence: number;
  riskLevel: OptimizationRiskLevel;
  requiresApproval: boolean;
  changes: OptimizationChange[];
  evidence?: string[];
}

export interface OptimizationExpectedImpact {
  latencyReductionPercent?: number;
  costReductionPercent?: number;
  reliabilityGainPercent?: number;
  summary: string;
}

export interface WorkflowDefinitionDiff {
  from: { versionId?: string; versionNumber: number };
  to: { versionId?: string; versionNumber: number };
  identical: boolean;
  nodes: {
    added: string[];
    removed: string[];
    changed: Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }>;
  };
  edges: { added: string[]; removed: string[] };
}

export interface IWorkflowOptimization extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  workflowId: Types.ObjectId;
  createdBy: Types.ObjectId;
  type: OptimizationType;
  status: OptimizationPlanStatus;
  recommendations: OptimizationRecommendation[];
  confidence: number;
  riskLevel: OptimizationRiskLevel;
  expectedImpact: OptimizationExpectedImpact;
  approvalRequired: boolean;
  analysis?: Record<string, unknown>;
  aiExplanation?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  appliedBy?: Types.ObjectId;
  appliedAt?: Date;
  appliedVersionId?: Types.ObjectId;
  appliedVersionNumber?: number;
  beforeAfter?: WorkflowDefinitionDiff;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowOptimizationSchema = new Schema<IWorkflowOptimization>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: OPTIMIZATION_TYPES, required: true },
  status: { type: String, enum: OPTIMIZATION_PLAN_STATUSES, default: 'PENDING' },
  recommendations: { type: Schema.Types.Mixed, required: true, default: [] },
  confidence: { type: Number, required: true, min: 0, max: 100 },
  riskLevel: { type: String, enum: OPTIMIZATION_RISK_LEVELS, required: true },
  expectedImpact: { type: Schema.Types.Mixed, required: true },
  approvalRequired: { type: Boolean, default: false },
  analysis: { type: Schema.Types.Mixed },
  aiExplanation: { type: String, maxlength: 4000 },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  rejectedAt: { type: Date },
  rejectionReason: { type: String, maxlength: 500 },
  appliedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  appliedAt: { type: Date },
  appliedVersionId: { type: Schema.Types.ObjectId, ref: 'WorkflowVersion' },
  appliedVersionNumber: { type: Number, min: 1 },
  beforeAfter: { type: Schema.Types.Mixed },
  failureReason: { type: String, maxlength: 500 },
}, { timestamps: true, minimize: false });

WorkflowOptimizationSchema.index({ workspaceId: 1, createdAt: -1 });
WorkflowOptimizationSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
WorkflowOptimizationSchema.index({ workflowId: 1, createdAt: -1 });

export const WorkflowOptimizationModel = mongoose.model<IWorkflowOptimization>(
  'WorkflowOptimization',
  WorkflowOptimizationSchema,
);
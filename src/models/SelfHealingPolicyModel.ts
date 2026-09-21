import mongoose, { Schema, Document, Types } from 'mongoose';

export type SelfHealingActionType =
  | 'AUTO_RETRY_WITH_ADAPTED_PARAMS'
  | 'FALLBACK_ROUTE'
  | 'CIRCUIT_BREAKER_TRIP'
  | 'PARAMETER_MUTATION_HEAL'
  | 'INCREASE_TIMEOUT'
  | 'CHANGE_PARAMETER'
  | 'USE_FALLBACK_NODE'
  | 'RETRY_NODE'
  | 'ESCALATE_TO_HUMAN';

export type SelfHealingTriggerCondition =
  | 'ERROR_CODE_MATCH'
  | 'TIMEOUT_PATTERN'
  | 'RATE_LIMIT_EXCEEDED'
  | 'DATA_VALIDATION_ANOMALY';

export type HealingRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface HealingAction {
  action: SelfHealingActionType;
  reason: string;
  confidence: number;
  riskLevel: HealingRiskLevel;
  requiresApproval: boolean;
  metadata?: Record<string, unknown>;
}

export interface RecoveryPlan {
  actions: HealingAction[];
  overallRisk: HealingRiskLevel;
  requiresApproval: boolean;
  estimatedImpact: string;
}

export interface ISelfHealingPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  workflowId?: Types.ObjectId;
  name: string;
  description?: string;
  failureTypes?: string[];
  triggerCondition: SelfHealingTriggerCondition;
  triggerValue: string;
  allowedActions?: SelfHealingActionType[];
  actionType: SelfHealingActionType;
  actionConfig: Record<string, unknown>;
  isEnabled: boolean;
  priority: number;
  maxAutomaticRetries: number;
  requireApproval: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SelfHealingPolicySchema = new Schema<ISelfHealingPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow' },
  name: { type: String, required: true, trim: true },
  description: { type: String },
  failureTypes: [{ type: String }],
  triggerCondition: {
    type: String,
    enum: ['ERROR_CODE_MATCH', 'TIMEOUT_PATTERN', 'RATE_LIMIT_EXCEEDED', 'DATA_VALIDATION_ANOMALY'],
    required: true,
  },
  triggerValue: { type: String, required: true },
  allowedActions: [{ type: String }],
  actionType: {
    type: String,
    enum: [
      'AUTO_RETRY_WITH_ADAPTED_PARAMS',
      'FALLBACK_ROUTE',
      'CIRCUIT_BREAKER_TRIP',
      'PARAMETER_MUTATION_HEAL',
      'INCREASE_TIMEOUT',
      'CHANGE_PARAMETER',
      'USE_FALLBACK_NODE',
      'RETRY_NODE',
      'ESCALATE_TO_HUMAN',
    ],
    required: true,
  },
  actionConfig: { type: Schema.Types.Mixed, required: true, default: {} },
  isEnabled: { type: Boolean, default: true },
  priority: { type: Number, default: 10 },
  maxAutomaticRetries: { type: Number, default: 3 },
  requireApproval: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

SelfHealingPolicySchema.index({ workspaceId: 1, isEnabled: 1 });
SelfHealingPolicySchema.index({ workspaceId: 1, priority: 1 });
SelfHealingPolicySchema.index({ workspaceId: 1, workflowId: 1 });

export const SelfHealingPolicyModel = mongoose.model<ISelfHealingPolicy>(
  'SelfHealingPolicy',
  SelfHealingPolicySchema
);
import mongoose, { Schema, Document, Types } from 'mongoose';
import type { SelfHealingActionType } from './SelfHealingPolicyModel.js';

export type SelfHealingIncidentStatus =
  | 'PROPOSED'
  | 'PENDING_APPROVAL'
  | 'EXECUTED'
  | 'REJECTED'
  | 'FAILED'
  | 'RESOLVED';

export interface ISelfHealingIncident extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  executionId: Types.ObjectId;
  workflowId: Types.ObjectId;
  policyId?: Types.ObjectId;
  triggerCondition: string;
  errorDetails: {
    message: string;
    code?: string;
    stack?: string;
    nodeId?: string;
  };
  rootCause?: string;
  confidenceScore?: number;
  suggestedRemediation?: string;
  actionType: SelfHealingActionType;
  actionConfig?: Record<string, unknown>;
  status: SelfHealingIncidentStatus;
  requiresApproval: boolean;
  approvalToken?: string;
  approvalExpiresAt?: Date;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  result?: Record<string, unknown>;
  replayedExecutionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SelfHealingIncidentSchema = new Schema<ISelfHealingIncident>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  executionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
  policyId: { type: Schema.Types.ObjectId, ref: 'SelfHealingPolicy' },
  triggerCondition: { type: String, required: true },
  errorDetails: {
    message: { type: String, required: true },
    code: { type: String },
    stack: { type: String },
    nodeId: { type: String },
  },
  rootCause: { type: String },
  confidenceScore: { type: Number, min: 0, max: 100 },
  suggestedRemediation: { type: String },
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
  actionConfig: { type: Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: [
      'PROPOSED',
      'PENDING_APPROVAL',
      'EXECUTED',
      'REJECTED',
      'FAILED',
      'RESOLVED',
    ],
    default: 'PROPOSED',
  },
  requiresApproval: { type: Boolean, default: false },
  approvalToken: { type: String },
  approvalExpiresAt: { type: Date },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  rejectedAt: { type: Date },
  rejectionReason: { type: String },
  result: { type: Schema.Types.Mixed },
  replayedExecutionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution' },
}, { timestamps: true });

SelfHealingIncidentSchema.index({ workspaceId: 1, status: 1 });
SelfHealingIncidentSchema.index({ executionId: 1 });
SelfHealingIncidentSchema.index({ approvalToken: 1 }, { sparse: true });

export const SelfHealingIncidentModel = mongoose.model<ISelfHealingIncident>(
  'SelfHealingIncident',
  SelfHealingIncidentSchema
);

import mongoose, { Schema, Document, Types } from 'mongoose';

export type SelfHealingActionType =
  | 'AUTO_RETRY_WITH_ADAPTED_PARAMS'
  | 'FALLBACK_ROUTE'
  | 'CIRCUIT_BREAKER_TRIP'
  | 'PARAMETER_MUTATION_HEAL';

export type SelfHealingTriggerCondition =
  | 'ERROR_CODE_MATCH'
  | 'TIMEOUT_PATTERN'
  | 'RATE_LIMIT_EXCEEDED'
  | 'DATA_VALIDATION_ANOMALY';

export interface ISelfHealingPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  name: string;
  description?: string;
  triggerCondition: SelfHealingTriggerCondition;
  triggerValue: string; // e.g., error code, timeout threshold, rate limit value
  actionType: SelfHealingActionType;
  actionConfig: Record<string, unknown>; // configuration for the action (e.g., retry count, fallback URL)
  isEnabled: boolean;
  priority: number; // lower number means higher priority
  createdAt: Date;
  updatedAt: Date;
}

const SelfHealingPolicySchema = new Schema<ISelfHealingPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String },
  triggerCondition: {
    type: String,
    enum: ['ERROR_CODE_MATCH', 'TIMEOUT_PATTERN', 'RATE_LIMIT_EXCEEDED', 'DATA_VALIDATION_ANOMALY'],
    required: true,
  },
  triggerValue: { type: String, required: true },
  actionType: {
    type: String,
    enum: [
      'AUTO_RETRY_WITH_ADAPTED_PARAMS',
      'FALLBACK_ROUTE',
      'CIRCUIT_BREAKER_TRIP',
      'PARAMETER_MUTATION_HEAL',
    ],
    required: true,
  },
  actionConfig: { type: Schema.Types.Mixed, required: true, default: {} },
  isEnabled: { type: Boolean, default: true },
  priority: { type: Number, default: 10 },
}, { timestamps: true });

SelfHealingPolicySchema.index({ workspaceId: 1, isEnabled: 1 });
SelfHealingPolicySchema.index({ workspaceId: 1, priority: 1 });

export const SelfHealingPolicyModel = mongoose.model<ISelfHealingPolicy>(
  'SelfHealingPolicy',
  SelfHealingPolicySchema
);
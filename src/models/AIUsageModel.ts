import mongoose, { Schema, Types } from 'mongoose';

export type AIFeatureType = 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation';

export interface IAIUsage {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  feature: AIFeatureType;
  tokensUsed: number;
  requests: number;
  costEstimate: number;
  model?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const AIUsageSchema = new Schema<IAIUsage>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  feature: {
    type: String,
    enum: ['workflow_generation', 'failure_analysis', 'optimization', 'template_generation'],
    required: true,
  },
  tokensUsed: { type: Number, required: true, default: 0, min: 0 },
  requests: { type: Number, required: true, default: 1, min: 0 },
  costEstimate: { type: Number, required: true, default: 0, min: 0 },
  model: { type: String, trim: true },
}, { timestamps: true });

AIUsageSchema.index({ workspaceId: 1, createdAt: -1 });
AIUsageSchema.index({ workspaceId: 1, feature: 1 });
AIUsageSchema.index({ userId: 1 });

export const AIUsageModel = mongoose.model<IAIUsage>('AIUsage', AIUsageSchema);

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAgentReview extends Document<Types.ObjectId> {
  agentMarketplaceId: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  rating: number;
  review?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentReviewSchema = new Schema<IAgentReview>({
  agentMarketplaceId: { type: Schema.Types.ObjectId, ref: 'AgentMarketplace', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  review: { type: String, maxlength: 1000 },
}, { timestamps: true });

AgentReviewSchema.index({ agentMarketplaceId: 1, userId: 1 }, { unique: true });
AgentReviewSchema.index({ agentMarketplaceId: 1, createdAt: -1 });

export const AgentReviewModel = mongoose.model<IAgentReview>('AgentReview', AgentReviewSchema);
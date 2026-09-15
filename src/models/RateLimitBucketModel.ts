import mongoose, { Schema, Document, Types } from 'mongoose';

export type RateLimitType = 'API_KEY' | 'WORKSPACE';

export interface IRateLimitBucket extends Document<Types.ObjectId> {
  apiKeyId?: Types.ObjectId;
  workspaceId: Types.ObjectId;
  limitType: RateLimitType;
  windowStart: number; // Unix timestamp in seconds
  windowSeconds: number;
  requestCount: number;
  limit: number;
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitBucketSchema = new Schema<IRateLimitBucket>({
  apiKeyId: { type: Schema.Types.ObjectId, ref: 'APIKey' },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  limitType: { type: String, enum: ['API_KEY', 'WORKSPACE'], required: true },
  windowStart: { type: Number, required: true },
  windowSeconds: { type: Number, required: true },
  requestCount: { type: Number, required: true, default: 0 },
  limit: { type: Number, required: true },
}, { timestamps: true });

// Compound indexes for efficient querying
RateLimitBucketSchema.index({ apiKeyId: 1, windowStart: 1 });
RateLimitBucketSchema.index({ workspaceId: 1, windowStart: 1 });

export const RateLimitBucketModel = mongoose.model<IRateLimitBucket>('RateLimitBucket', RateLimitBucketSchema);
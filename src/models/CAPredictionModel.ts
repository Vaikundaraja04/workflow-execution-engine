import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICAPrediction extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  queueDepthPrediction: number;
  queueThroughputPrediction: number;
  recommendedWorkerCount: number;
  currentWorkerCount: number;
  utilizationRate: number; // 0-100
  queueGrowthRate: number; // jobs per hour
  predictedAt: Date;
  horizon: '1h' | '6h' | '24h' | '7d' | '30d';
  modelVersion: string;
}

const CAPredictionSchema = new Schema<ICAPrediction>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  queueDepthPrediction: { type: Number, required: true, min: 0 },
  queueThroughputPrediction: { type: Number, required: true, min: 0 },
  recommendedWorkerCount: { type: Number, required: true, min: 1 },
  currentWorkerCount: { type: Number, required: true, min: 1 },
  utilizationRate: { type: Number, required: true, min: 0, max: 100 },
  queueGrowthRate: { type: Number, required: true, min: -100 }, // can be negative if shrinking
  predictedAt: { type: Date, required: true, default: Date.now },
  horizon: {
    type: String,
    enum: ['1h', '6h', '24h', '7d', '30d'],
    default: '24h',
  },
  modelVersion: { type: String, default: 'v1.0.0' },
}, { timestamps: true });

CAPredictionSchema.index({ workspaceId: 1, predictedAt: -1 });
CAPredictionSchema.index({ workspaceId: 1, utilizationRate: 1 });

export const CAPredictionModel = mongoose.model<ICAPrediction>('CAPrediction', CAPredictionSchema);
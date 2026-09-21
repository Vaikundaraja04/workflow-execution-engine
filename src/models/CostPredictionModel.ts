import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICostPrediction extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  monthlyAiCostPrediction: number;
  monthlyExecutionCostPrediction: number;
  monthlyStorageCostPrediction: number;
  currentMonthlyAiCost: number;
  currentMonthlyExecutionCost: number;
  currentMonthlyStorageCost: number;
  storageGrowthRateGBPerMonth: number;
  predictedAt: Date;
  horizon: '1h' | '6h' | '24h' | '7d' | '30d';
  modelVersion: string;
}

const CostPredictionSchema = new Schema<ICostPrediction>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  monthlyAiCostPrediction: { type: Number, required: true, min: 0 },
  monthlyExecutionCostPrediction: { type: Number, required: true, min: 0 },
  monthlyStorageCostPrediction: { type: Number, required: true, min: 0 },
  currentMonthlyAiCost: { type: Number, required: true, min: 0 },
  currentMonthlyExecutionCost: { type: Number, required: true, min: 0 },
  currentMonthlyStorageCost: { type: Number, required: true, min: 0 },
  storageGrowthRateGBPerMonth: { type: Number, required: true },
  predictedAt: { type: Date, required: true, default: Date.now },
  horizon: {
    type: String,
    enum: ['1h', '6h', '24h', '7d', '30d'],
    default: '24h',
  },
  modelVersion: { type: String, default: 'v1.0.0' },
}, { timestamps: true });

CostPredictionSchema.index({ workspaceId: 1, predictedAt: -1 });
CostPredictionSchema.index({ workspaceId: 1, monthlyAiCostPrediction: 1 });

export const CostPredictionModel = mongoose.model<ICostPrediction>('CostPrediction', CostPredictionSchema);
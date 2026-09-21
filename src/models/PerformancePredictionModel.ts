import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPerformancePrediction extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  workflowId?: Types.ObjectId;
  executionId?: Types.ObjectId;
  predictedDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  latencySpikeRisk: 'none' | 'low' | 'medium' | 'high';
  predictedAt: Date;
  horizon: '1h' | '6h' | '24h' | '7d' | '30d';
  modelVersion: string;
}

const PerformancePredictionSchema = new Schema<IPerformancePrediction>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow' },
  executionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution' },
  predictedDurationMs: { type: Number, required: true, min: 0 },
  p50DurationMs: { type: Number, required: true, min: 0 },
  p95DurationMs: { type: Number, required: true, min: 0 },
  p99DurationMs: { type: Number, required: true, min: 0 },
  latencySpikeRisk: {
    type: String,
    enum: ['none', 'low', 'medium', 'high'],
    default: 'none',
  },
  predictedAt: { type: Date, required: true, default: Date.now },
  horizon: {
    type: String,
    enum: ['1h', '6h', '24h', '7d', '30d'],
    default: '24h',
  },
  modelVersion: { type: String, default: 'v1.0.0' },
}, { timestamps: true });

PerformancePredictionSchema.index({ workspaceId: 1, workflowId: 1 });
PerformancePredictionSchema.index({ workspaceId: 1, predictedAt: -1 });
PerformancePredictionSchema.index({ executionId: 1 });

export const PerformancePredictionModel = mongoose.model<IPerformancePrediction>('PerformancePrediction', PerformancePredictionSchema);
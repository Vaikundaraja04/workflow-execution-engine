import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFailurePrediction extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  workflowId?: Types.ObjectId;
  executionId?: Types.ObjectId;
  failureProbability: number; // 0-100
  riskyNodes: Array<{
    nodeId: string;
    nodeType: string;
    failureLikelihood: number;
    contributingFactors: string[];
  }>;
  predictedAt: Date;
  horizon: '1h' | '6h' | '24h' | '7d' | '30d';
  modelVersion: string;
}

const FailurePredictionSchema = new Schema<IFailurePrediction>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow' },
  executionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution' },
  failureProbability: { type: Number, required: true, min: 0, max: 100 },
  riskyNodes: {
    type: [
      {
        nodeId: { type: String, required: true },
        nodeType: { type: String, required: true },
        failureLikelihood: { type: Number, required: true, min: 0, max: 100 },
        contributingFactors: [{ type: String, default: [] }],
      },
    ],
    default: [],
  },
  predictedAt: { type: Date, required: true, default: Date.now },
  horizon: {
    type: String,
    enum: ['1h', '6h', '24h', '7d', '30d'],
    default: '24h',
  },
  modelVersion: { type: String, default: 'v1.0.0' },
}, { timestamps: true });

FailurePredictionSchema.index({ workspaceId: 1, workflowId: 1 });
FailurePredictionSchema.index({ workspaceId: 1, predictedAt: -1 });
FailurePredictionSchema.index({ executionId: 1 });

export const FailurePredictionModel = mongoose.model<IFailurePrediction>('FailurePrediction', FailurePredictionSchema);
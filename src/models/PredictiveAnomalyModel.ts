import mongoose, { Schema, Document, Types, model } from 'mongoose';

export interface IPredictiveAnomaly extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  workflowId: Types.ObjectId;
  executionId: Types.ObjectId;
  anomalyType: 'queue_depth' | 'error_rate' | 'memory_pressure' | 'execution_drift' | 'sla_breach_risk';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidenceScore: number; // 0-100
  metrics: Record<string, any>;
  predictedFailureTime: Date;
  recommendedActions: string[];
  isAcknowledged: boolean;
  acknowledgedBy?: Types.ObjectId;
  acknowledgedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PredictiveAnomalySchema = new Schema<IPredictiveAnomaly>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
    executionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
    anomalyType: {
      type: String,
      required: true,
      enum: ['queue_depth', 'error_rate', 'memory_pressure', 'execution_drift', 'sla_breach_risk']
    },
    severity: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'critical']
    },
    confidenceScore: { type: Number, required: true, min: 0, max: 100 },
    metrics: { type: Schema.Types.Mixed, required: true, default: {} },
    predictedFailureTime: { type: Date, required: true },
    recommendedActions: { type: [String], required: true, default: [] },
    isAcknowledged: { type: Boolean, required: true, default: false },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes for quick querying
PredictiveAnomalySchema.index({ workspaceId: 1, workflowId: 1 });
PredictiveAnomalySchema.index({ executionId: 1 });
PredictiveAnomalySchema.index({ predictedFailureTime: 1 });
PredictiveAnomalySchema.index({ isAcknowledged: 1 });

export const PredictiveAnomalyModel = model<IPredictiveAnomaly>('PredictiveAnomaly', PredictiveAnomalySchema);
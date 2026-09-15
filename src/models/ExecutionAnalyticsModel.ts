import mongoose, { Schema, Document, Types } from 'mongoose';

export const ANALYTICS_EXECUTION_STATUSES = ['SUCCEEDED', 'FAILED'] as const;

export type AnalyticsExecutionStatus = (typeof ANALYTICS_EXECUTION_STATUSES)[number];

export interface IExecutionAnalytics extends Document<Types.ObjectId> {
  executionId: Types.ObjectId;
  workflowId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  status: AnalyticsExecutionStatus;
  durationMs: number;
  retryCount: number;
  nodeCount: number;
  createdAt: Date;
}

const ExecutionAnalyticsSchema = new Schema<IExecutionAnalytics>({
  executionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  status: { type: String, enum: ANALYTICS_EXECUTION_STATUSES, required: true },
  durationMs: { type: Number, required: true, min: 0, default: 0 },
  retryCount: { type: Number, required: true, min: 0, default: 0 },
  nodeCount: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

ExecutionAnalyticsSchema.index({ executionId: 1 }, { unique: true });
ExecutionAnalyticsSchema.index({ workflowId: 1, createdAt: -1 });
ExecutionAnalyticsSchema.index({ workspaceId: 1, createdAt: -1 });
ExecutionAnalyticsSchema.index({ createdAt: -1 });

export const ExecutionAnalyticsModel = mongoose.model<IExecutionAnalytics>(
  'ExecutionAnalytics',
  ExecutionAnalyticsSchema,
);
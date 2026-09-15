import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWorkflowAnalytics extends Document<Types.ObjectId> {
  workflowId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  replayCount: number;
  averageDurationMs: number;
  lastExecutedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowAnalyticsSchema = new Schema<IWorkflowAnalytics>({
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  totalExecutions: { type: Number, required: true, min: 0, default: 0 },
  successfulExecutions: { type: Number, required: true, min: 0, default: 0 },
  failedExecutions: { type: Number, required: true, min: 0, default: 0 },
  replayCount: { type: Number, required: true, min: 0, default: 0 },
  averageDurationMs: { type: Number, required: true, min: 0, default: 0 },
  lastExecutedAt: { type: Date },
}, { timestamps: true });

WorkflowAnalyticsSchema.index({ workflowId: 1 }, { unique: true });
WorkflowAnalyticsSchema.index({ workspaceId: 1, createdAt: -1 });

export const WorkflowAnalyticsModel = mongoose.model<IWorkflowAnalytics>(
  'WorkflowAnalytics',
  WorkflowAnalyticsSchema,
);
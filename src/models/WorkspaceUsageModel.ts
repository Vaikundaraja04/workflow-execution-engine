import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWorkspaceUsage extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  totalWorkflows: number;
  totalExecutions: number;
  successfulExecutions: number;
  monthlyExecutions: number;
  monthKey: string;
  successRate: number;
  averageExecutionTime: number;
  storageUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceUsageSchema = new Schema<IWorkspaceUsage>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  totalWorkflows: { type: Number, required: true, min: 0, default: 0 },
  totalExecutions: { type: Number, required: true, min: 0, default: 0 },
  successfulExecutions: { type: Number, required: true, min: 0, default: 0 },
  monthlyExecutions: { type: Number, required: true, min: 0, default: 0 },
  monthKey: { type: String, required: true, default: '' },
  successRate: { type: Number, required: true, min: 0, max: 1, default: 0 },
  averageExecutionTime: { type: Number, required: true, min: 0, default: 0 },
  storageUsed: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true });

WorkspaceUsageSchema.index({ workspaceId: 1 }, { unique: true });
WorkspaceUsageSchema.index({ updatedAt: -1 });

export const WorkspaceUsageModel = mongoose.model<IWorkspaceUsage>(
  'WorkspaceUsage',
  WorkspaceUsageSchema,
);
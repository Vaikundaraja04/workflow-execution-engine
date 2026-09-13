import mongoose, { Schema, Document, Types } from 'mongoose';
import type { WorkflowDefinition } from '../types/workflow.js';

export interface IWorkflowVersion extends Document {
  workflowId: Types.ObjectId;
  versionNumber: number;
  definition: WorkflowDefinition;
  createdAt: Date;
}

const WorkflowVersionSchema = new Schema<IWorkflowVersion>({
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
  versionNumber: { type: Number, required: true, min: 1 },
  definition: { type: Schema.Types.Mixed, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

WorkflowVersionSchema.index({ workflowId: 1, versionNumber: 1 }, { unique: true });

export const WorkflowVersionModel = mongoose.model<IWorkflowVersion>('WorkflowVersion', WorkflowVersionSchema);

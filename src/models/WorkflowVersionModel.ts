import mongoose, { Schema, Document, Types } from 'mongoose';
import type { WorkflowDefinition } from '../types/workflow.js';

export const VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

export type VersionStatus = (typeof VERSION_STATUSES)[number];

export interface IWorkflowVersion extends Document {
  workflowId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  versionNumber: number;
  definition: WorkflowDefinition;
  definitionHash?: string;
  createdBy?: Types.ObjectId;
  sourceVersionId?: Types.ObjectId;
  changeSummary?: string;
  status: VersionStatus;
  createdAt: Date;
}

const WorkflowVersionSchema = new Schema<IWorkflowVersion>({
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  versionNumber: { type: Number, required: true, min: 1 },
  definition: { type: Schema.Types.Mixed, required: true },
  definitionHash: { type: String, maxlength: 128 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  sourceVersionId: { type: Schema.Types.ObjectId, ref: 'WorkflowVersion' },
  changeSummary: { type: String, maxlength: 280 },
  status: { type: String, enum: VERSION_STATUSES, default: 'PUBLISHED' },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

WorkflowVersionSchema.index({ workflowId: 1, versionNumber: 1 }, { unique: true });
WorkflowVersionSchema.index({ workflowId: 1, definitionHash: 1 });
WorkflowVersionSchema.index({ workspaceId: 1, createdAt: -1 });

export const WorkflowVersionModel = mongoose.model<IWorkflowVersion>(
  'WorkflowVersion',
  WorkflowVersionSchema,
);

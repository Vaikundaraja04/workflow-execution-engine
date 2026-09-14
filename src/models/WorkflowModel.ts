import mongoose, { Schema, Document, Types } from 'mongoose';
import type { WorkflowDefinition } from '../types/workflow.js';

export interface IWorkflow extends Document {
  name: string;
  ownerId: Types.ObjectId;
  draftDefinition: WorkflowDefinition;
  status: 'DRAFT' | 'PUBLISHED';
  latestVersionNumber: number;
  publishedVersionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowSchema = new Schema<IWorkflow>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  draftDefinition: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT' },
  latestVersionNumber: { type: Number, default: 0 },
  publishedVersionId: { type: Schema.Types.ObjectId, ref: 'WorkflowVersion' },
}, { timestamps: true, minimize: false });

export const WorkflowModel = mongoose.model<IWorkflow>('Workflow', WorkflowSchema);

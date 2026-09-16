import mongoose, { Schema, Document, Types } from 'mongoose';
import type { WorkflowDefinition } from '../types/workflow.js';

export interface ITemplateVersion extends Document<Types.ObjectId> {
  templateId: Types.ObjectId;
  versionNumber: number; // incremental version (1, 2, 3, ...)
  workflowDefinition: WorkflowDefinition; // JSON structure of the workflow at this version
  definitionHash: string; // hash of the workflowDefinition for change detection
  changeSummary: string; // optional description of what changed
  createdBy: Types.ObjectId; // user who created this version
  createdAt: Date;
}

const TemplateVersionSchema = new Schema<ITemplateVersion>({
  templateId: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', required: true },
  versionNumber: { type: Number, required: true, min: 1 },
  workflowDefinition: { type: Schema.Types.Mixed, required: true },
  definitionHash: { type: String, maxlength: 128, required: true },
  changeSummary: { type: String, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

// Indexes
TemplateVersionSchema.index({ templateId: 1, versionNumber: 1 }, { unique: true });
TemplateVersionSchema.index({ templateId: 1, definitionHash: 1 });
TemplateVersionSchema.index({ createdAt: -1 });

export const TemplateVersionModel = mongoose.model<ITemplateVersion>('TemplateVersion', TemplateVersionSchema);
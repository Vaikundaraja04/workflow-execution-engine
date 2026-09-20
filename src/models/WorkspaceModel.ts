import mongoose, { Schema, Document, Types } from 'mongoose';

export type WorkspaceStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface IWorkspace extends Document<Types.ObjectId> {
  name: string;
  slug: string;
  description?: string;
  ownerId: Types.ObjectId;
  status: WorkspaceStatus;
  settings?: Record<string, unknown>;
  region?: string; // e.g., us-east-1, eu-west-1
  dataResidency?: boolean; // if true, data must reside in the assigned region
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 64 },
  description: { type: String, maxlength: 280 },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'DELETED'], default: 'ACTIVE' },
  settings: { type: Schema.Types.Mixed },
  region: { type: String },
  dataResidency: { type: Boolean },
}, { timestamps: true });


WorkspaceSchema.index({ ownerId: 1 });

export const WorkspaceModel = mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);
import mongoose, { Schema, Document, Types } from 'mongoose';

export type SCIMTokenStatus = 'ACTIVE' | 'REVOKED';

export interface ISCIMToken extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  tokenHash: string;
  prefix: string;
  description?: string;
  status: SCIMTokenStatus;
  createdBy: Types.ObjectId;
  lastUsedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SCIMTokenSchema = new Schema<ISCIMToken>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  tokenHash: { type: String, required: true, unique: true },
  prefix: { type: String, required: true, maxlength: 16 },
  description: { type: String, maxlength: 256 },
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lastUsedAt: { type: Date },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

SCIMTokenSchema.index({ workspaceId: 1, status: 1 });
SCIMTokenSchema.index({ expiresAt: 1 });

export const SCIMTokenModel = mongoose.model<ISCIMToken>('SCIMToken', SCIMTokenSchema);
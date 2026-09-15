import mongoose, { Schema, Document, Types } from 'mongoose';
import type { Permission } from '../auth/permissions.js';

export type APIKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface IAPIKey extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  name: string;
  keyHash: string;
  keyPrefix: string;
  status: APIKeyStatus;
  permissions: Permission[];
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdBy: Types.ObjectId;
  revokedAt?: Date;
  revokedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const APIKeySchema = new Schema<IAPIKey>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  keyHash: { type: String, required: true, unique: true },
  keyPrefix: { type: String, required: true, maxlength: 16 },
  status: { type: String, enum: ['ACTIVE', 'REVOKED', 'EXPIRED'], default: 'ACTIVE' },
  permissions: { type: [String], default: [] },
  lastUsedAt: { type: Date },
  expiresAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  revokedAt: { type: Date },
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

APIKeySchema.index({ workspaceId: 1 });
APIKeySchema.index({ status: 1 });
APIKeySchema.index({ workspaceId: 1, status: 1 });

export const APIKeyModel = mongoose.model<IAPIKey>('APIKey', APIKeySchema);

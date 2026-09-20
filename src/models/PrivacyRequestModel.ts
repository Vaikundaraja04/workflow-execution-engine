import mongoose, { Schema, Document, Types } from 'mongoose';

export const PRIVACY_REQUEST_TYPES = ['EXPORT', 'DELETE'] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'EXPIRED'] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export interface IPrivacyRequest extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  requestType: PrivacyRequestType;
  status: PrivacyRequestStatus;
  requestedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  filePath?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PrivacyRequestSchema = new Schema<IPrivacyRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', index: true },
    requestType: { type: String, enum: PRIVACY_REQUEST_TYPES, required: true, index: true },
    status: { type: String, enum: PRIVACY_REQUEST_STATUSES, required: true, default: 'PENDING', index: true },
    requestedAt: { type: Date, default: Date.now, index: true },
    processedAt: { type: Date },
    completedAt: { type: Date },
    expiresAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
    filePath: { type: String, maxlength: 512 },
    errorMessage: { type: String, maxlength: 1024 },
  },
  { timestamps: true }
);

PrivacyRequestSchema.index({ userId: 1, status: 1 });
PrivacyRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PrivacyRequestModel = mongoose.model<IPrivacyRequest>('PrivacyRequest', PrivacyRequestSchema);
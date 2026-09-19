import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUserSession extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  sessionTokenHash: string;
  ipAddress: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  location?: string;
  isRevoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
  lastActiveAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSessionSchema = new Schema<IUserSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', index: true },
    sessionTokenHash: { type: String, required: true, unique: true, index: true },
    ipAddress: { type: String, required: true, maxlength: 64 },
    userAgent: { type: String, maxlength: 512 },
    browser: { type: String, maxlength: 64, default: 'Unknown' },
    os: { type: String, maxlength: 64, default: 'Unknown' },
    deviceType: { type: String, maxlength: 32, default: 'desktop' },
    location: { type: String, maxlength: 128, default: 'Unknown' },
    isRevoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date },
    revokedReason: { type: String, maxlength: 256 },
    lastActiveAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

UserSessionSchema.index({ userId: 1, isRevoked: 1, expiresAt: 1 });

export const UserSessionModel = mongoose.model<IUserSession>('UserSession', UserSessionSchema);

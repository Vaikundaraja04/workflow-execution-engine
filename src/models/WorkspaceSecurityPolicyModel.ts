import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWorkspaceSecurityPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  enforceMfa: boolean;
  sessionTimeoutMinutes: number;
  maxConcurrentSessions: number;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  passwordExpiryDays: number;
  passwordHistoryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSecurityPolicySchema = new Schema<IWorkspaceSecurityPolicy>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true, index: true },
    ipAllowlistEnabled: { type: Boolean, default: false },
    ipAllowlist: { type: [String], default: [] },
    enforceMfa: { type: Boolean, default: false },
    sessionTimeoutMinutes: { type: Number, default: 1440, min: 15, max: 43200 },
    maxConcurrentSessions: { type: Number, default: 5, min: 1, max: 50 },
    passwordMinLength: { type: Number, default: 12, min: 8, max: 128 },
    passwordRequireUppercase: { type: Boolean, default: true },
    passwordRequireNumbers: { type: Boolean, default: true },
    passwordRequireSymbols: { type: Boolean, default: true },
    passwordExpiryDays: { type: Number, default: 90, min: 0, max: 365 },
    passwordHistoryCount: { type: Number, default: 5, min: 0, max: 24 },
  },
  { timestamps: true }
);

export const WorkspaceSecurityPolicyModel = mongoose.model<IWorkspaceSecurityPolicy>(
  'WorkspaceSecurityPolicy',
  WorkspaceSecurityPolicySchema
);

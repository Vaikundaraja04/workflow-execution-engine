import mongoose, { Schema, Document, Types } from 'mongoose';

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'REMOVED';

export interface IWorkspaceMember extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  status: MembershipStatus;
  invitedBy?: Types.ObjectId;
  lastActiveAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMemberSchema = new Schema<IWorkspaceMember>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'], required: true },
  status: { type: String, enum: ['ACTIVE', 'INVITED', 'REMOVED'], default: 'ACTIVE' },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  lastActiveAt: { type: Date },
}, { timestamps: true });

WorkspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
WorkspaceMemberSchema.index({ userId: 1, role: 1 });

export const WorkspaceMemberModel = mongoose.model<IWorkspaceMember>(
  'WorkspaceMember',
  WorkspaceMemberSchema,
);
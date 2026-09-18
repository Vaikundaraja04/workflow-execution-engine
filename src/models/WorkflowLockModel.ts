import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWorkflowLock extends Document<Types.ObjectId> {
  workflowId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  userEmail: string;
  userName: string;
  lockToken: string;
  acquiredAt: Date;
  expiresAt: Date;
  lastHeartbeat: Date;
}

const WorkflowLockSchema = new Schema<IWorkflowLock>(
  {
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true, unique: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userEmail: { type: String, required: true },
    userName: { type: String, required: true },
    lockToken: { type: String, required: true },
    acquiredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, // MongoDB TTL index to auto-remove expired locks
    lastHeartbeat: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

WorkflowLockSchema.index({ workspaceId: 1, userId: 1 });

export const WorkflowLockModel = mongoose.model<IWorkflowLock>('WorkflowLock', WorkflowLockSchema);

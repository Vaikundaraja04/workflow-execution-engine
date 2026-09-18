import mongoose, { Schema, Document, Types } from 'mongoose';

export type NotificationType =
  | 'COMMENT_MENTION'
  | 'COMMENT_REPLY'
  | 'WORKFLOW_LOCK_CONFLICT'
  | 'WORKFLOW_SHARED'
  | 'EXECUTION_COMPLETED'
  | 'EXECUTION_FAILED'
  | 'WORKSPACE_INVITE'
  | 'SYSTEM';

export interface INotification extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  isRead: boolean;
  readAt?: Date | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    type: {
      type: String,
      enum: [
        'COMMENT_MENTION',
        'COMMENT_REPLY',
        'WORKFLOW_LOCK_CONFLICT',
        'WORKFLOW_SHARED',
        'EXECUTION_COMPLETED',
        'EXECUTION_FAILED',
        'WORKSPACE_INVITE',
        'SYSTEM',
      ],
      required: true,
    },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 1000 },
    resourceType: { type: String, maxlength: 64 },
    resourceId: { type: String, maxlength: 128 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ workspaceId: 1, createdAt: -1 });

export const NotificationModel = mongoose.model<INotification>('Notification', NotificationSchema);

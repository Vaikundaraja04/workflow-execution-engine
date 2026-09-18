import mongoose, { Schema, Document, Types } from 'mongoose';

export type CommentStatus = 'OPEN' | 'RESOLVED';

export interface IWorkflowComment extends Document<Types.ObjectId> {
  workflowId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  authorId: Types.ObjectId;
  authorName: string;
  authorEmail: string;
  nodeId?: string | null | undefined;
  content: string;
  parentCommentId?: Types.ObjectId | null | undefined;
  mentions: string[];
  status: CommentStatus;
  resolvedBy?: Types.ObjectId | null | undefined;
  resolvedAt?: Date | null | undefined;
  isEdited: boolean;
  editedAt?: Date | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowCommentSchema = new Schema<IWorkflowComment>(
  {
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, required: true, maxlength: 100 },
    authorEmail: { type: String, required: true, maxlength: 255 },
    nodeId: { type: String, maxlength: 128, default: null },
    content: { type: String, required: true, maxlength: 4000 },
    parentCommentId: { type: Schema.Types.ObjectId, ref: 'WorkflowComment', default: null, index: true },
    mentions: [{ type: String }],
    status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

WorkflowCommentSchema.index({ workflowId: 1, createdAt: 1 });
WorkflowCommentSchema.index({ workspaceId: 1, createdAt: -1 });
WorkflowCommentSchema.index({ workflowId: 1, nodeId: 1 });

export const WorkflowCommentModel = mongoose.model<IWorkflowComment>('WorkflowComment', WorkflowCommentSchema);

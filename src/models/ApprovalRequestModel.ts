import mongoose, { Schema, Document, Types } from 'mongoose';

export const APPROVAL_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export const APPROVAL_RESOURCE_TYPES = ['AGENT_TOOL', 'AGENT_RUN', 'WORKFLOW', 'POLICY', 'AI_OPERATION'] as const;
export type ApprovalResourceType = (typeof APPROVAL_RESOURCE_TYPES)[number];

export interface IApprovalRequest extends Document {
  workspaceId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  resourceType: ApprovalResourceType;
  resourceId: string;
  action: string;
  status: ApprovalRequestStatus;
  approvedBy?: Types.ObjectId;
  rejectedBy?: Types.ObjectId;
  reason?: string;
  payload?: Record<string, unknown>;
  expiresAt?: Date;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApprovalRequestSchema = new Schema<IApprovalRequest>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resourceType: { type: String, enum: [...APPROVAL_RESOURCE_TYPES], required: true },
    resourceId: { type: String, required: true },
    action: { type: String, required: true, maxlength: 200 },
    status: { type: String, enum: [...APPROVAL_REQUEST_STATUSES], default: 'PENDING', index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, maxlength: 1000 },
    payload: { type: Schema.Types.Mixed },
    expiresAt: { type: Date, index: true },
    decidedAt: { type: Date },
  },
  { timestamps: true },
);

ApprovalRequestSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
ApprovalRequestSchema.index({ workspaceId: 1, resourceType: 1, resourceId: 1 });

export const ApprovalRequestModel =
  (mongoose.models.ApprovalRequest as mongoose.Model<IApprovalRequest> | undefined) ??
  mongoose.model<IApprovalRequest>('ApprovalRequest', ApprovalRequestSchema);

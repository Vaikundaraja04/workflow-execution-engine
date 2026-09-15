import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDeadLetter extends Document<Types.ObjectId> {
  executionId: Types.ObjectId;
  workflowId?: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  failureReason: string;
  message?: string;
  attempts: number;
  failedAt: Date;
  createdAt: Date;
}

const DeadLetterSchema = new Schema<IDeadLetter>({
  executionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution', required: true },
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow' },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  failureReason: { type: String, required: true, maxlength: 128 },
  message: { type: String, maxlength: 512 },
  attempts: { type: Number, required: true, min: 0 },
  failedAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

DeadLetterSchema.index({ executionId: 1 }, { unique: true });
DeadLetterSchema.index({ workspaceId: 1, failedAt: -1 });
DeadLetterSchema.index({ workflowId: 1, failedAt: -1 });
DeadLetterSchema.index({ failedAt: -1 });

export const DeadLetterModel = mongoose.model<IDeadLetter>('DeadLetter', DeadLetterSchema);

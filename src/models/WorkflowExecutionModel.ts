import mongoose, { Schema, Document, Types } from 'mongoose';
import type { ExecutionResult } from '../types/workflow.js';
import type {
  ExecutionStatus,
  ExecutionStatusEvent,
  StoredExecutionError,
} from '../types/execution.js';
import { EXECUTION_STATUSES } from '../types/execution.js';

export interface IWorkflowExecution extends Document<Types.ObjectId> {
  workflowId: Types.ObjectId;
  ownerId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  workflowVersionId: Types.ObjectId;
  versionNumber: number;
  jobId: string;
  idempotencyKey: string;
  inputHash: string;
  input: Record<string, unknown>;
  status: ExecutionStatus;
  result?: ExecutionResult;
  error?: StoredExecutionError;
  attemptsMade: number;
  statusHistory: ExecutionStatusEvent[];
  queuedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ExecutionStatusEventSchema = new Schema<ExecutionStatusEvent>({
  status: { type: String, enum: EXECUTION_STATUSES, required: true },
  timestamp: { type: Date, required: true },
  attempt: { type: Number, min: 1 },
}, { _id: false });

const WorkflowExecutionSchema = new Schema<IWorkflowExecution>({
  workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  workflowVersionId: { type: Schema.Types.ObjectId, ref: 'WorkflowVersion', required: true },
  versionNumber: { type: Number, required: true, min: 1 },
  jobId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, maxlength: 128 },
  inputHash: { type: String, required: true },
  input: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: EXECUTION_STATUSES, required: true },
  result: { type: Schema.Types.Mixed },
  error: { type: Schema.Types.Mixed },
  attemptsMade: { type: Number, required: true, min: 0, default: 0 },
  statusHistory: { type: [ExecutionStatusEventSchema], required: true, default: [] },
  queuedAt: { type: Date },
  startedAt: { type: Date },
  finishedAt: { type: Date },
}, { timestamps: true, minimize: false });

WorkflowExecutionSchema.index({ workflowId: 1, idempotencyKey: 1 }, { unique: true });
WorkflowExecutionSchema.index({ workflowId: 1, createdAt: -1 });
WorkflowExecutionSchema.index({ status: 1, updatedAt: 1 });
WorkflowExecutionSchema.index({ workspaceId: 1, createdAt: -1 });

export const WorkflowExecutionModel = mongoose.model<IWorkflowExecution>(
  'WorkflowExecution',
  WorkflowExecutionSchema,
);

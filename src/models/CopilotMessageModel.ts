import mongoose, { Schema, Document, Types } from 'mongoose';
import { COPILOT_INTENTS } from './CopilotSessionModel.js';
import type { CopilotIntent, CopilotArtifact } from './CopilotSessionModel.js';

export const COPILOT_MESSAGE_STATUSES = [
  'COMPLETED',
  'FAILED',
  'NEEDS_REVIEW',
  'REPAIR_EXHAUSTED',
  'INTENT_UNSUPPORTED',
] as const;

export type CopilotMessageRole = 'user' | 'assistant' | 'system';

export type CopilotMessageStatus = (typeof COPILOT_MESSAGE_STATUSES)[number];

export const COPILOT_MESSAGE_STATUS_SET: ReadonlySet<CopilotMessageStatus> = new Set(COPILOT_MESSAGE_STATUSES);

export interface CopilotRepairAttempt {
  attempt: number;
  validationErrors: Array<{ type: string; message: string; nodeId?: string }>;
}

export interface ICopilotMessage extends Document<Types.ObjectId> {
  sessionId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: CopilotMessageRole;
  content: string;
  intent?: CopilotIntent;
  status: CopilotMessageStatus;
  artifacts: CopilotArtifact[];
  repairAttempts: CopilotRepairAttempt[];
  repairCount: number;
  createdAt: Date;
}

const CopilotMessageSchema = new Schema<ICopilotMessage>({
  sessionId: { type: Schema.Types.ObjectId, ref: 'CopilotSession', required: true, index: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  intent: {
    type: String,
    enum: [...COPILOT_INTENTS],
  },
  status: {
    type: String,
    enum: [...COPILOT_MESSAGE_STATUSES],
    default: 'COMPLETED',
  },
  artifacts: [{ kind: { type: String }, data: { type: Schema.Types.Mixed } }],
  repairAttempts: [{
    _id: false,
    attempt: Number,
    validationErrors: [{ type: Schema.Types.Mixed }],
  }],
  repairCount: { type: Number, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

CopilotMessageSchema.index({ sessionId: 1, createdAt: 1 });

export const CopilotMessageModel = mongoose.model<ICopilotMessage>('CopilotMessage', CopilotMessageSchema);
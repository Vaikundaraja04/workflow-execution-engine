import mongoose, { Schema, Document, Types } from 'mongoose';

export const COPILOT_INTENTS = [
  'BUILD_WORKFLOW',
  'MODIFY_WORKFLOW',
  'EXPLAIN_WORKFLOW',
  'VALIDATE_WORKFLOW',
] as const;

export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

export const COPILOT_INTENT_SET: ReadonlySet<CopilotIntent> = new Set(COPILOT_INTENTS);

export interface CopilotArtifact {
  kind: 'DRAFT_WORKFLOW' | 'CHANGE_PLAN' | 'EXPLANATION' | 'VALIDATION_REPORT';
  data: unknown;
}

export interface ICopilotSession extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  intentCounts: {
    BUILD_WORKFLOW: number;
    MODIFY_WORKFLOW: number;
    EXPLAIN_WORKFLOW: number;
    VALIDATE_WORKFLOW: number;
  };
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CopilotSessionSchema = new Schema<ICopilotSession>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, maxlength: 200 },
  status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  intentCounts: {
    BUILD_WORKFLOW: { type: Number, default: 0 },
    MODIFY_WORKFLOW: { type: Number, default: 0 },
    EXPLAIN_WORKFLOW: { type: Number, default: 0 },
    VALIDATE_WORKFLOW: { type: Number, default: 0 },
  },
  lastMessageAt: { type: Date },
}, { timestamps: true });

CopilotSessionSchema.index({ workspaceId: 1, userId: 1, updatedAt: -1 });

export const CopilotSessionModel = mongoose.model<ICopilotSession>('CopilotSession', CopilotSessionSchema);
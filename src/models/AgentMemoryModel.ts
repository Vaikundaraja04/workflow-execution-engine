import mongoose, { Schema, Document, Types } from 'mongoose';

export const AGENT_MEMORY_SCOPES = ['RUN', 'WORKFLOW', 'WORKSPACE'] as const;
export type AgentMemoryScope = (typeof AGENT_MEMORY_SCOPES)[number];

export interface IAgentMemory extends Document {
  agentId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  scope: AgentMemoryScope;
  scopeId?: string;
  key: string;
  value: unknown;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemorySchema = new Schema<IAgentMemory>(
  {
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    scope: { type: String, enum: [...AGENT_MEMORY_SCOPES], required: true },
    scopeId: { type: String },
    key: { type: String, required: true, trim: true, maxlength: 200 },
    value: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true },
);

AgentMemorySchema.index({ agentId: 1, workspaceId: 1, scope: 1, key: 1 }, { unique: true });
AgentMemorySchema.index({ workspaceId: 1, agentId: 1 });
AgentMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

export const AgentMemoryModel =
  (mongoose.models.AgentMemory as mongoose.Model<IAgentMemory> | undefined) ??
  mongoose.model<IAgentMemory>('AgentMemory', AgentMemorySchema);

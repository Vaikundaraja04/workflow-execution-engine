import mongoose, { Schema, Document, Types } from 'mongoose';

export const AGENT_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ORCHESTRATION_MODES = [
  'autonomous',
  'sequential',
  'parallel',
  'consensus',
  'supervisor_worker',
] as const;
export type AgentOrchestrationModeDoc = (typeof AGENT_ORCHESTRATION_MODES)[number];

export interface IAgent extends Document {
  workspaceId: Types.ObjectId;
  name: string;
  description?: string;
  systemPrompt: string;
  modelConfig: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxTurns?: number;
  };
  orchestrationMode: AgentOrchestrationModeDoc;
  toolsAllowed: string[];
  requiredPermissions: string[];
  memoryEnabled: boolean;
  status: AgentStatus;
  version: number;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AgentSchema = new Schema<IAgent>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 1000 },
    systemPrompt: { type: String, required: true, maxlength: 8000 },
    modelConfig: {
      provider: { type: String, default: 'mock' },
      model: { type: String },
      temperature: { type: Number, min: 0, max: 2, default: 0.7 },
      maxTokens: { type: Number, min: 1, default: 1000 },
      maxTurns: { type: Number, min: 1, max: 25, default: 5 },
    },
    orchestrationMode: {
      type: String,
      enum: [...AGENT_ORCHESTRATION_MODES],
      default: 'autonomous',
    },
    toolsAllowed: { type: [String], default: [] },
    requiredPermissions: { type: [String], default: [] },
    memoryEnabled: { type: Boolean, default: false },
    status: { type: String, enum: [...AGENT_STATUSES], default: 'DRAFT', index: true },
    version: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

AgentSchema.index({ workspaceId: 1, name: 1 }, { unique: true });
AgentSchema.index({ workspaceId: 1, status: 1 });

export const AgentModel = (mongoose.models.Agent as mongoose.Model<IAgent> | undefined) ??
  mongoose.model<IAgent>('Agent', AgentSchema);

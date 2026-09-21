import mongoose, { Schema, Document, Types } from 'mongoose';

export const AGENT_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export interface IAgentRunTraceEvent {
  turn: number;
  timestamp: Date;
  action: 'thought' | 'tool_call' | 'tool_result' | 'delegation' | 'final_output' | 'approval_requested' | 'approval_resolved';
  content: string;
  toolName?: string;
  toolResult?: unknown;
}

export interface IAgentRunToolCall {
  toolName: string;
  args: Record<string, unknown>;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REQUIRES_APPROVAL' | 'DENIED';
  result?: unknown;
  error?: string;
  approvalId?: Types.ObjectId;
  executedAt?: Date;
}

export interface IAgentRun extends Document {
  agentId: Types.ObjectId;
  executionId?: Types.ObjectId;
  workspaceId: Types.ObjectId;
  status: AgentRunStatus;
  trace: IAgentRunTraceEvent[];
  toolCalls: IAgentRunToolCall[];
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  output?: string;
  requestedBy: Types.ObjectId;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TraceEventSchema = new Schema<IAgentRunTraceEvent>(
  {
    turn: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
    action: {
      type: String,
      enum: ['thought', 'tool_call', 'tool_result', 'delegation', 'final_output', 'approval_requested', 'approval_resolved'],
      required: true,
    },
    content: { type: String, required: true },
    toolName: { type: String },
    toolResult: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const ToolCallSchema = new Schema<IAgentRunToolCall>(
  {
    toolName: { type: String, required: true },
    args: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REQUIRES_APPROVAL', 'DENIED'],
      default: 'PENDING',
    },
    result: { type: Schema.Types.Mixed },
    error: { type: String },
    approvalId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    executedAt: { type: Date },
  },
  { _id: false },
);

const AgentRunSchema = new Schema<IAgentRun>(
  {
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    executionId: { type: Schema.Types.ObjectId, ref: 'WorkflowExecution' },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    status: { type: String, enum: [...AGENT_RUN_STATUSES], default: 'PENDING', index: true },
    trace: { type: [TraceEventSchema], default: [] },
    toolCalls: { type: [ToolCallSchema], default: [] },
    tokenUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
    output: { type: String },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

AgentRunSchema.index({ workspaceId: 1, agentId: 1, createdAt: -1 });
AgentRunSchema.index({ workspaceId: 1, status: 1 });

export const AgentRunModel =
  (mongoose.models.AgentRun as mongoose.Model<IAgentRun> | undefined) ??
  mongoose.model<IAgentRun>('AgentRun', AgentRunSchema);

import mongoose, { Schema, Document, Types } from 'mongoose';

export const AGENT_TOOL_POLICIES = ['ALLOW', 'DENY', 'REQUIRE_APPROVAL'] as const;
export type AgentToolPolicyValue = (typeof AGENT_TOOL_POLICIES)[number];

export interface IAgentToolPolicy extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  toolName: string;
  policy: AgentToolPolicyValue;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AgentToolPolicySchema = new Schema<IAgentToolPolicy>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  toolName: { type: String, required: true, trim: true, maxlength: 120 },
  policy: { type: String, enum: AGENT_TOOL_POLICIES, required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

AgentToolPolicySchema.index({ workspaceId: 1, toolName: 1 }, { unique: true });

export const AgentToolPolicyModel = mongoose.model<IAgentToolPolicy>(
  'AgentToolPolicy',
  AgentToolPolicySchema,
);
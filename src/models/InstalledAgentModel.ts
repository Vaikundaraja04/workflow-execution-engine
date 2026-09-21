import mongoose, { Schema, Document, Types } from 'mongoose';

export const INSTALLED_AGENT_STATUSES = ['ACTIVE', 'DISABLED', 'UNINSTALLED'] as const;
export type InstalledAgentStatus = (typeof INSTALLED_AGENT_STATUSES)[number];

export interface IInstalledAgentConfiguration {
  model?: string;
  temperature?: number;
  maxTurns?: number;
  toolsAllowed?: string[];
  memoryEnabled?: boolean;
}

export interface IInstalledAgent extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  agentMarketplaceId: Types.ObjectId;
  agentId: Types.ObjectId;
  installedVersion: number;
  configuration: IInstalledAgentConfiguration;
  installedBy: Types.ObjectId;
  status: InstalledAgentStatus;
  installedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InstalledAgentSchema = new Schema<IInstalledAgent>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  agentMarketplaceId: { type: Schema.Types.ObjectId, ref: 'AgentMarketplace', required: true, index: true },
  agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
  installedVersion: { type: Number, required: true, min: 1 },
  configuration: { type: Schema.Types.Mixed, default: {} },
  installedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: [...INSTALLED_AGENT_STATUSES], default: 'ACTIVE' },
  installedAt: { type: Date, default: Date.now },
}, { timestamps: true, minimize: false });

InstalledAgentSchema.index({ workspaceId: 1, agentMarketplaceId: 1 }, { unique: true });
InstalledAgentSchema.index({ workspaceId: 1, status: 1 });

export const InstalledAgentModel = mongoose.model<IInstalledAgent>('InstalledAgent', InstalledAgentSchema);
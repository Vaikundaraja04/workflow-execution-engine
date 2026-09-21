import mongoose, { Schema, Document, Types } from 'mongoose';
import type { IAgentDefinitionSnapshot } from './AgentMarketplaceModel.js';

export interface IAgentGovernanceSnapshot {
  checkedAt?: Date;
  reasonCodes: string[];
  modelChecked?: string;
  toolPolicies: Record<string, string>;
}

export interface IAgentVersion extends Document<Types.ObjectId> {
  agentMarketplaceId: Types.ObjectId;
  versionNumber: number;
  agentDefinitionSnapshot: IAgentDefinitionSnapshot;
  toolConfiguration: Record<string, string>;
  governanceSnapshot: IAgentGovernanceSnapshot;
  changeSummary: string;
  hash: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const AgentVersionSchema = new Schema<IAgentVersion>({
  agentMarketplaceId: { type: Schema.Types.ObjectId, ref: 'AgentMarketplace', required: true, index: true },
  versionNumber: { type: Number, required: true, min: 1 },
  agentDefinitionSnapshot: { type: Schema.Types.Mixed, required: true },
  toolConfiguration: { type: Schema.Types.Mixed, default: {} },
  governanceSnapshot: { type: Schema.Types.Mixed, default: { reasonCodes: [], toolPolicies: {} } },
  changeSummary: { type: String, default: '', maxlength: 500 },
  hash: { type: String, required: true, maxlength: 128 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

AgentVersionSchema.index({ agentMarketplaceId: 1, versionNumber: 1 }, { unique: true });
AgentVersionSchema.index({ agentMarketplaceId: 1, hash: 1 });

export const AgentVersionModel = mongoose.model<IAgentVersion>('AgentVersion', AgentVersionSchema);
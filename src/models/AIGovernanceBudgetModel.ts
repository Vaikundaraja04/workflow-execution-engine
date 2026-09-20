import mongoose, { Schema, Document, Types, model } from 'mongoose';

export interface IAIGovernanceBudget extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  monthlyTokenLimit: number; // in tokens
  monthlyCostLimitUSD: number; // in USD
  currentTokenUsage: number;
  currentCostUSD: number;
  alertThreshold: number; // percentage (0-100) at which to alert
  throttleThreshold: number; // percentage (0-100) at which to throttle
  blockThreshold: number; // percentage (0-100) at which to block
  alertEnabled: boolean;
  throttleEnabled: boolean;
  blockEnabled: boolean;
  lastResetDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AIGovernanceBudgetSchema = new Schema<IAIGovernanceBudget>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
    monthlyTokenLimit: { type: Number, required: true, default: 1000000 },
    monthlyCostLimitUSD: { type: Number, required: true, default: 100.0 },
    currentTokenUsage: { type: Number, required: true, default: 0 },
    currentCostUSD: { type: Number, required: true, default: 0.0 },
    alertThreshold: { type: Number, required: true, default: 80 }, // 80%
    throttleThreshold: { type: Number, required: true, default: 90 }, // 90%
    blockThreshold: { type: Number, required: true, default: 100 }, // 100%
    alertEnabled: { type: Boolean, required: true, default: true },
    throttleEnabled: { type: Boolean, required: true, default: true },
    blockEnabled: { type: Boolean, required: true, default: true },
    lastResetDate: { type: Date, required: true, default: Date.now },
  },
  {
    timestamps: true,
  }
);

export const AIGovernanceBudgetModel = model<IAIGovernanceBudget>('AIGovernanceBudget', AIGovernanceBudgetSchema);
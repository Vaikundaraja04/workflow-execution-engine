import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 18.1 - Enterprise accounts.
 *
 * The commercial record for a workspace: who owns the relationship, what was
 * signed, when it renews and where the account stands. Tenant settings and the
 * subscription stay authoritative - this record never duplicates billing state,
 * it names the account an operator manages.
 */

export const ENTERPRISE_CUSTOMER_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'AT_RISK',
  'SUSPENDED',
  'CHURNED',
] as const;
export type EnterpriseCustomerStatus = (typeof ENTERPRISE_CUSTOMER_STATUSES)[number];

export const CONTRACT_TYPES = ['MONTHLY', 'ANNUAL', 'MULTI_YEAR', 'CUSTOM'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export interface IEnterpriseAccount {
  workspaceId: Types.ObjectId;
  company: string;
  industry: string;
  accountOwnerId: Types.ObjectId;
  contractType: ContractType;
  subscriptionPlan: string | null;
  renewalDate: Date | null;
  customerStatus: EnterpriseCustomerStatus;
  mrr: number | null;
  seats: number | null;
  notes: string | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const EnterpriseAccountSchema = new Schema<IEnterpriseAccount>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  company: { type: String, required: true, trim: true, maxlength: 160 },
  industry: { type: String, required: true, trim: true, maxlength: 80, default: 'UNKNOWN' },
  accountOwnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  contractType: { type: String, enum: [...CONTRACT_TYPES], required: true, default: 'ANNUAL' },
  subscriptionPlan: { type: String, default: null, maxlength: 40 },
  renewalDate: { type: Date, default: null },
  customerStatus: { type: String, enum: [...ENTERPRISE_CUSTOMER_STATUSES], required: true, default: 'TRIAL' },
  mrr: { type: Number, default: null, min: 0 },
  seats: { type: Number, default: null, min: 0 },
  notes: { type: String, default: null, maxlength: 2000 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, minimize: false });

EnterpriseAccountSchema.index({ customerStatus: 1, renewalDate: 1 });
EnterpriseAccountSchema.index({ industry: 1 });
EnterpriseAccountSchema.index({ accountOwnerId: 1 });

export const EnterpriseAccountModel = mongoose.model<IEnterpriseAccount>(
  'EnterpriseAccount',
  EnterpriseAccountSchema,
);
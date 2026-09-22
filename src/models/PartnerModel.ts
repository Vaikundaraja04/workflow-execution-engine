import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 16.6 - Partnership & marketplace growth.
 *
 * A partner is a reseller / agency that refers demand in exchange for a
 * commission. Referrals link a partner to the lead and (once signed) the
 * workspace, so commission can be computed from the payments those customers
 * actually made. A partner record never grants workspace access.
 */

export const PARTNER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_TIERS = ['BRONZE', 'SILVER', 'GOLD'] as const;
export type PartnerTier = (typeof PARTNER_TIERS)[number];

export const PARTNER_REFERRAL_STATUSES = ['REFERRED', 'REGISTERED', 'CUSTOMER', 'CHURNED'] as const;
export type PartnerReferralStatus = (typeof PARTNER_REFERRAL_STATUSES)[number];

export interface IPartnerReferral {
  leadId?: Types.ObjectId | null;
  workspaceId?: Types.ObjectId | null;
  referredAt: Date;
  status: PartnerReferralStatus;
}

export interface IPartner {
  name: string;
  company: string;
  contactName: string;
  contactEmail: string;
  code: string;
  status: PartnerStatus;
  tier: PartnerTier;
  commissionRatePercent: number;
  notes?: string | null;
  createdBy?: Types.ObjectId | null;
  referrals: IPartnerReferral[];
  createdAt: Date;
  updatedAt: Date;
}

const PartnerReferralSchema = new Schema<IPartnerReferral>({
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  referredAt: { type: Date, required: true, default: Date.now },
  status: { type: String, enum: [...PARTNER_REFERRAL_STATUSES], required: true, default: 'REFERRED' },
}, { _id: false });

const PartnerSchema = new Schema<IPartner>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  company: { type: String, required: true, trim: true, maxlength: 160 },
  contactName: { type: String, required: true, trim: true, maxlength: 160 },
  contactEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32, unique: true },
  status: { type: String, enum: [...PARTNER_STATUSES], required: true, default: 'ACTIVE' },
  tier: { type: String, enum: [...PARTNER_TIERS], required: true, default: 'BRONZE' },
  commissionRatePercent: { type: Number, required: true, min: 0, max: 50, default: 20 },
  notes: { type: String, trim: true, maxlength: 2000, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  referrals: { type: [PartnerReferralSchema], default: [] },
}, { timestamps: true });

PartnerSchema.index({ contactEmail: 1 });
PartnerSchema.index({ status: 1, tier: 1 });
PartnerSchema.index({ 'referrals.workspaceId': 1 });

export const PartnerModel = mongoose.model<IPartner>('Partner', PartnerSchema);

export function isPartnerStatus(value: unknown): value is PartnerStatus {
  return typeof value === 'string' && (PARTNER_STATUSES as readonly string[]).includes(value);
}

import mongoose, { Schema, Types } from 'mongoose';
import type { SubscriptionPlan } from './SubscriptionModel.js';

export const TENANT_STATUSES = ['TRIALING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const ONBOARDING_STEPS = ['company', 'use_case', 'templates', 'invite_team'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface ITenantOnboarding {
  completed: boolean;
  steps: string[];
  startedAt: Date;
  completedAt?: Date | null;
}

export interface ITenantAccount {
  workspaceId: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  companyName: string;
  status: TenantStatus;
  plan: SubscriptionPlan;
  subscriptionId?: Types.ObjectId | null;
  region: string;
  trialEndsAt?: Date | null;
  demo: boolean;
  useCase?: string | null;
  emailVerifiedAt?: Date | null;
  onboarding: ITenantOnboarding;
  createdAt: Date;
  updatedAt: Date;
}
const OnboardingSchema = new Schema<ITenantOnboarding>({
  completed: { type: Boolean, required: true, default: false },
  steps: { type: [String], default: [] },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date, default: null },
}, { _id: false });

const TenantAccountSchema = new Schema<ITenantAccount>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  companyName: { type: String, required: true, trim: true, maxlength: 160 },
  status: { type: String, enum: [...TENANT_STATUSES], required: true, default: 'TRIALING' },
  plan: {
    type: String,
    enum: ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'],
    required: true,
    default: 'FREE',
  },
  subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
  region: { type: String, required: true, default: 'us-east-1' },
  trialEndsAt: { type: Date, default: null },
  demo: { type: Boolean, required: true, default: false },
  useCase: { type: String, default: null, maxlength: 280 },
  emailVerifiedAt: { type: Date, default: null },
  onboarding: { type: OnboardingSchema, required: true, default: () => ({}) },
}, { timestamps: true });

TenantAccountSchema.index({ ownerUserId: 1 });
TenantAccountSchema.index({ status: 1, createdAt: -1 });
TenantAccountSchema.index({ demo: 1, updatedAt: -1 });

export const TenantAccountModel = mongoose.model<ITenantAccount>('TenantAccount', TenantAccountSchema);
import mongoose, { Schema, Document, Types } from 'mongoose';
import type { SubscriptionPlan } from './SubscriptionModel.js';

export interface PlanLimits {
  workflows: number;
  executionsPerMonth: number;
  apiKeys: number;
  webhooks: number;
  members: number;
  storageBytes: number;
}

export interface IPlan extends Document<Types.ObjectId> {
  id: SubscriptionPlan;
  name: string;
  description: string;
  priceMonthly: number; // in cents/currency units, e.g. 0, 2900, 9900, 49900
  currency: string;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  FREE: {
    workflows: 10,
    executionsPerMonth: 1000,
    apiKeys: 2,
    webhooks: 2,
    members: 3,
    storageBytes: 100 * 1024 * 1024, // 100 MB
  },
  STARTER: {
    workflows: 50,
    executionsPerMonth: 10000,
    apiKeys: 10,
    webhooks: 10,
    members: 10,
    storageBytes: 1024 * 1024 * 1024, // 1 GB
  },
  PROFESSIONAL: {
    workflows: 250,
    executionsPerMonth: 100000,
    apiKeys: 50,
    webhooks: 50,
    members: 50,
    storageBytes: 10 * 1024 * 1024 * 1024, // 10 GB
  },
  ENTERPRISE: {
    workflows: 10000,
    executionsPerMonth: 10000000,
    apiKeys: 1000,
    webhooks: 1000,
    members: 1000,
    storageBytes: 1024 * 1024 * 1024 * 1024, // 1 TB
  },
};

export const DEFAULT_PLANS: Record<SubscriptionPlan, {
  id: SubscriptionPlan;
  name: string;
  description: string;
  priceMonthly: number;
  currency: string;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
}> = {
  FREE: {
    id: 'FREE',
    name: 'Free Plan',
    description: 'Basic workflow execution capabilities for individuals and small projects',
    priceMonthly: 0,
    currency: 'USD',
    limits: PLAN_LIMITS.FREE,
    features: ['Up to 10 workflows', '1,000 executions/month', 'Community support', 'Basic analytics'],
    isActive: true,
  },
  STARTER: {
    id: 'STARTER',
    name: 'Starter Plan',
    description: 'Great for growing teams and startups building automated workflows',
    priceMonthly: 2900, // $29.00
    currency: 'USD',
    limits: PLAN_LIMITS.STARTER,
    features: ['Up to 50 workflows', '10,000 executions/month', 'Email support', 'Team collaboration', '10 API keys & webhooks'],
    isActive: true,
  },
  PROFESSIONAL: {
    id: 'PROFESSIONAL',
    name: 'Professional Plan',
    description: 'For organizations with high-volume workflows and scaling requirements',
    priceMonthly: 9900, // $99.00
    currency: 'USD',
    limits: PLAN_LIMITS.PROFESSIONAL,
    features: ['Up to 250 workflows', '100,000 executions/month', 'Priority support', 'Advanced analytics & auditing', '50 API keys & webhooks'],
    isActive: true,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise Plan',
    description: 'Dedicated infrastructure, custom integrations, SLA and maximum quotas',
    priceMonthly: 49900, // $499.00
    currency: 'USD',
    limits: PLAN_LIMITS.ENTERPRISE,
    features: ['Unlimited workflows & high volume executions', 'Dedicated support & SLAs', 'Custom webhooks & integrations', 'Enterprise audit logging & DR'],
    isActive: true,
  },
};

const PlanLimitsSchema = new Schema<PlanLimits>({
  workflows: { type: Number, required: true },
  executionsPerMonth: { type: Number, required: true },
  apiKeys: { type: Number, required: true },
  webhooks: { type: Number, required: true },
  members: { type: Number, required: true },
  storageBytes: { type: Number, required: true },
}, { _id: false });

const PlanSchema = new Schema<IPlan>({
  id: {
    type: String,
    enum: ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'],
    required: true,
    unique: true
  },
  name: { type: String, required: true },
  description: { type: String, required: true },
  priceMonthly: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: 'USD' },
  limits: { type: PlanLimitsSchema, required: true },
  features: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export const PlanModel = mongoose.model<IPlan>('Plan', PlanSchema);

export async function ensureDefaultPlans(): Promise<void> {
  const count = await PlanModel.countDocuments();
  if (count === 0) {
    await PlanModel.insertMany(Object.values(DEFAULT_PLANS));
  }
}
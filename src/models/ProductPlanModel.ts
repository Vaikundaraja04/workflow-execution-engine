import mongoose, { Schema, Types } from 'mongoose';
import type { SubscriptionPlan } from './SubscriptionModel.js';

/**
 * Phase 14.1 - Product Packaging System.
 *
 * A product plan is the commercially sellable package (Starter / Business /
 * Enterprise). It is a projection over the internal SubscriptionPlan catalog:
 * pricing, packaging limits (workflows, executions, AI usage, agents, storage),
 * support level and the feature entitlements the package unlocks.
 */

export const PRODUCT_PACKAGE_IDS = ['STARTER', 'BUSINESS', 'ENTERPRISE'] as const;
export type ProductPackageId = (typeof PRODUCT_PACKAGE_IDS)[number];

export const SUPPORT_LEVELS = ['COMMUNITY', 'EMAIL', 'PRIORITY', 'DEDICATED'] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

/** Feature keys gated by plan entitlements (Phase 14.2). */
export const FEATURE_KEYS = [
  'WORKFLOWS',
  'EXECUTIONS',
  'AI_REQUESTS',
  'AI_AGENTS',
  'ANALYTICS',
  'AUDIT_LOGS',
  'MARKETPLACE',
  'SELF_HEALING',
  'SECRETS_VAULT',
  'GOVERNANCE',
  'SSO',
  'SCIM',
  'ADVANCED_MONITORING',
  'PREDICTIVE_INTELLIGENCE',
  'MULTI_REGION',
  'CUSTOM_INTEGRATIONS',
  'API_ACCESS',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const PRODUCT_PLAN_CURRENCIES = ['USD', 'INR'] as const;

export interface ProductPackaging {
  includedWorkflows: number;
  executionLimit: number; // executions per month
  aiRequestLimit: number; // AI tokens per month
  agentLimit: number; // active AI agents
  storageBytes: number;
  seats: number;
  supportLevel: SupportLevel;
  supportResponseHours: number | null;
  trialDays: number;
}

export interface IProductPlan {
  id: ProductPackageId;
  name: string;
  tagline: string;
  description: string;
  audience: string;
  internalPlan: SubscriptionPlan;
  priceMonthly: number; // in the currency's smallest unit (cents / paise)
  annualPriceMonthly: number; // effective monthly price on annual billing
  currency: string;
  packaging: ProductPackaging;
  entitlements: FeatureKey[];
  highlights: string[];
  addOns: string[];
  version: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function isProductPackageId(value: unknown): value is ProductPackageId {
  return typeof value === 'string' && (PRODUCT_PACKAGE_IDS as readonly string[]).includes(value);
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value);
}

type ProductPlanSeed = Omit<IProductPlan, 'createdAt' | 'updatedAt'>;

const BUSINESS_ENTITLEMENTS: FeatureKey[] = [
  'WORKFLOWS',
  'EXECUTIONS',
  'AI_REQUESTS',
  'AI_AGENTS',
  'ANALYTICS',
  'AUDIT_LOGS',
  'MARKETPLACE',
  'SELF_HEALING',
  'SECRETS_VAULT',
  'API_ACCESS',
];

export const DEFAULT_PRODUCT_PLANS: Record<ProductPackageId, ProductPlanSeed> = {
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    tagline: 'Automate your first critical workflows',
    description: 'Workflow automation with metered execution and AI usage limits for small teams getting started.',
    audience: 'Small teams and single-department automation',
    internalPlan: 'STARTER',
    priceMonthly: 2900,
    annualPriceMonthly: 2400,
    currency: 'USD',
    packaging: {
      includedWorkflows: 50,
      executionLimit: 10000,
      aiRequestLimit: 100000,
      agentLimit: 3,
      storageBytes: 1024 * 1024 * 1024,
      seats: 10,
      supportLevel: 'EMAIL',
      supportResponseHours: 24,
      trialDays: 14,
    },
    entitlements: ['WORKFLOWS', 'EXECUTIONS', 'AI_REQUESTS', 'API_ACCESS', 'MARKETPLACE'],
    highlights: [
      'Up to 50 workflows',
      '10,000 executions / month',
      '100,000 AI tokens / month',
      'Up to 3 AI agents',
      '1 GB storage',
      'Email support (24h response)',
    ],
    addOns: [],
    version: 1,
    sortOrder: 1,
    isActive: true,
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    tagline: 'Scale automation across departments',
    description: 'Production automation with AI agents, analytics, self-healing execution and audit visibility.',
    audience: 'Growing companies running critical automation in production',
    internalPlan: 'PROFESSIONAL',
    priceMonthly: 9900,
    annualPriceMonthly: 8200,
    currency: 'USD',
    packaging: {
      includedWorkflows: 250,
      executionLimit: 100000,
      aiRequestLimit: 2000000,
      agentLimit: 25,
      storageBytes: 10 * 1024 * 1024 * 1024,
      seats: 50,
      supportLevel: 'PRIORITY',
      supportResponseHours: 8,
      trialDays: 14,
    },
    entitlements: BUSINESS_ENTITLEMENTS,
    highlights: [
      'Up to 250 workflows',
      '100,000 executions / month',
      '2,000,000 AI tokens / month',
      'Up to 25 AI agents',
      'Advanced analytics and audit logs',
      'Self-healing execution',
      'Priority support (8h response)',
    ],
    addOns: ['EXTRA_EXECUTIONS', 'EXTRA_AI_TOKENS'],
    version: 1,
    sortOrder: 2,
    isActive: true,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Governed automation at global scale',
    description: 'AI governance, SSO/SCIM, advanced monitoring, multi-region deployment and dedicated support.',
    audience: 'Regulated enterprises and global platform teams',
    internalPlan: 'ENTERPRISE',
    priceMonthly: 49900,
    annualPriceMonthly: 41500,
    currency: 'USD',
    packaging: {
      includedWorkflows: 10000,
      executionLimit: 10000000,
      aiRequestLimit: 50000000,
      agentLimit: 250,
      storageBytes: 1024 * 1024 * 1024 * 1024,
      seats: 1000,
      supportLevel: 'DEDICATED',
      supportResponseHours: 1,
      trialDays: 14,
    },
    entitlements: [...FEATURE_KEYS],
    highlights: [
      'Unlimited-scale workflows',
      '10,000,000 executions / month',
      '50,000,000 AI tokens / month',
      'Up to 250 AI agents',
      'AI governance and policy enforcement',
      'SSO, SCIM and audit export',
      'Multi-region and advanced monitoring',
      'Dedicated support (1h response)',
    ],
    addOns: ['EXTRA_EXECUTIONS', 'EXTRA_AI_TOKENS', 'DEDICATED_REGION'],
    version: 1,
    sortOrder: 3,
    isActive: true,
  },
};
const ProductPackagingSchema = new Schema<ProductPackaging>({
  includedWorkflows: { type: Number, required: true, min: 0 },
  executionLimit: { type: Number, required: true, min: 0 },
  aiRequestLimit: { type: Number, required: true, min: 0 },
  agentLimit: { type: Number, required: true, min: 0 },
  storageBytes: { type: Number, required: true, min: 0 },
  seats: { type: Number, required: true, min: 1 },
  supportLevel: { type: String, enum: [...SUPPORT_LEVELS], required: true, default: 'EMAIL' },
  supportResponseHours: { type: Number, default: null, min: 0 },
  trialDays: { type: Number, required: true, min: 0, default: 14 },
}, { _id: false });

const ProductPlanSchema = new Schema<IProductPlan>({
  id: { type: String, enum: [...PRODUCT_PACKAGE_IDS], required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  tagline: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 600 },
  audience: { type: String, required: true, trim: true, maxlength: 200 },
  internalPlan: {
    type: String,
    enum: ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'],
    required: true,
  },
  priceMonthly: { type: Number, required: true, min: 0 },
  annualPriceMonthly: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: [...PRODUCT_PLAN_CURRENCIES], required: true, default: 'USD' },
  packaging: { type: ProductPackagingSchema, required: true },
  entitlements: { type: [String], enum: [...FEATURE_KEYS], default: [] },
  highlights: { type: [String], default: [] },
  addOns: { type: [String], default: [] },
  version: { type: Number, required: true, default: 1, min: 1 },
  sortOrder: { type: Number, required: true, default: 0 },
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });

ProductPlanSchema.index({ sortOrder: 1, priceMonthly: 1 });
ProductPlanSchema.index({ isActive: 1 });

export const ProductPlanModel = mongoose.model<IProductPlan>('ProductPlan', ProductPlanSchema);

export async function ensureDefaultProductPlans(): Promise<void> {
  const existing = await ProductPlanModel.countDocuments();
  if (existing > 0) return;
  await ProductPlanModel.insertMany(Object.values(DEFAULT_PRODUCT_PLANS));
}


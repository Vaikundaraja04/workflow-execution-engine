import { Types } from 'mongoose';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionPlan, SubscriptionStatus } from '../models/SubscriptionModel.js';
import { FEATURE_KEYS } from '../models/ProductPlanModel.js';
import type { FeatureKey, ProductPackageId } from '../models/ProductPlanModel.js';
import { PLAN_LIMITS } from '../models/PlanModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { AgentModel } from '../models/AgentModel.js';
import { UsageMeterModel, USAGE_METRICS } from '../models/UsageMeterModel.js';
import type { UsageMetric } from '../models/UsageMeterModel.js';
import { monthPeriodKey } from './usageMeteringService.js';
import { productPackagingService } from './productPackagingService.js';
import { roleHasPermission } from '../auth/permissions.js';
import type { Permission } from '../auth/permissions.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';

/**
 * Phase 14.2 - Feature Entitlement Engine.
 *
 * Single enforcement point that answers "can this workspace use this feature,
 * and how much of it is left?". It composes three existing sources of truth
 * instead of duplicating them:
 *
 * - billing  : the workspace subscription plan (SubscriptionModel).
 * - packaging: the sellable package limits (ProductPlanModel).
 * - metering : month-to-date usage (UsageMeterModel / usageMeteringService).
 *
 * RBAC stays authoritative for *who* may act (roles/permissions); entitlements
 * gate *what the plan includes*. When a role is supplied the engine also
 * requires the matching permission, so a plan feature never bypasses RBAC.
 */

export type EntitlementReason =
  | 'ENTITLED'
  | 'PLAN_UPGRADE_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'NO_SUBSCRIPTION'
  | 'ROLE_NOT_PERMITTED';

/**
 * Plan -> included features. This is the enforcement matrix and the source of
 * truth for the catalog's entitlement projection.
 */
export const PLAN_ENTITLEMENTS: Record<SubscriptionPlan, readonly FeatureKey[]> = {
  FREE: ['WORKFLOWS', 'EXECUTIONS', 'AI_REQUESTS', 'API_ACCESS'],
  STARTER: ['WORKFLOWS', 'EXECUTIONS', 'AI_REQUESTS', 'API_ACCESS', 'MARKETPLACE'],
  PROFESSIONAL: [
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
  ],
  ENTERPRISE: [...FEATURE_KEYS],
};

const PLAN_ORDER: readonly SubscriptionPlan[] = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];

/** Cheapest plan that includes each feature (used for upgrade prompts). */
export const MINIMUM_PLAN_FOR_FEATURE: Record<FeatureKey, SubscriptionPlan> = (() => {
  const matrix = {} as Record<FeatureKey, SubscriptionPlan>;
  for (const feature of FEATURE_KEYS) {
    matrix[feature] = PLAN_ORDER.find((plan) => PLAN_ENTITLEMENTS[plan].includes(feature)) ?? 'ENTERPRISE';
  }
  return matrix;
})();

/** Permission a role must hold to exercise a plan feature (RBAC integration). */
export const FEATURE_PERMISSIONS: Partial<Record<FeatureKey, Permission>> = {
  WORKFLOWS: 'WORKFLOW_CREATE',
  EXECUTIONS: 'WORKFLOW_EXECUTE',
  AI_REQUESTS: 'AI_BUSINESS_EXECUTE',
  AI_AGENTS: 'AGENT_EXECUTE',
  ANALYTICS: 'OPERATIONS_READ',
  AUDIT_LOGS: 'AUDIT_READ',
  MARKETPLACE: 'TEMPLATE_PUBLISH',
  GOVERNANCE: 'GOVERNANCE_READ',
  SSO: 'SECURITY_MANAGE',
  SCIM: 'MEMBER_MANAGE',
  SECRETS_VAULT: 'SECRETS_MANAGE',
};

/** Feature -> metered usage source. Features absent here are boolean-only. */
type FeatureUsageSource =
  | { kind: 'meter'; metric: UsageMetric }
  | { kind: 'count'; collection: 'workflows' | 'agents' };

const FEATURE_USAGE_SOURCE: Partial<Record<FeatureKey, FeatureUsageSource>> = {
  WORKFLOWS: { kind: 'count', collection: 'workflows' },
  EXECUTIONS: { kind: 'meter', metric: 'EXECUTIONS' },
  AI_REQUESTS: { kind: 'meter', metric: 'AI_TOKENS' },
  AI_AGENTS: { kind: 'count', collection: 'agents' },
};

export interface EntitlementDecision {
  workspaceId: string;
  feature: FeatureKey;
  entitled: boolean;
  reason: EntitlementReason;
  plan: SubscriptionPlan | null;
  subscriptionStatus: SubscriptionStatus | null;
  packageId: ProductPackageId | null;
  requiredPlan: SubscriptionPlan;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  evaluatedAt: string;
}

export interface FeatureQuotaSnapshot {
  feature: FeatureKey;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  percent: number | null;
  exceeded: boolean;
}

export interface EntitlementSummary {
  workspaceId: string;
  plan: SubscriptionPlan | null;
  subscriptionStatus: SubscriptionStatus | null;
  packageId: ProductPackageId | null;
  packageName: string | null;
  features: Array<{
    feature: FeatureKey;
    entitled: boolean;
    reason: EntitlementReason;
    requiredPlan: SubscriptionPlan;
  }>;
  quotas: FeatureQuotaSnapshot[];
  upgradeTargets: SubscriptionPlan[];
  generatedAt: string;
}

export class FeatureEntitlementService {
  isFeatureKey(value: unknown): value is FeatureKey {
    return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value);
  }

  /** Features included in a plan (used by the catalog and by comparisons). */
  featuresForPlan(plan: SubscriptionPlan): FeatureKey[] {
    return [...PLAN_ENTITLEMENTS[plan]];
  }

  planIncludes(plan: SubscriptionPlan, feature: FeatureKey): boolean {
    return PLAN_ENTITLEMENTS[plan].includes(feature);
  }

  /** Every metered metric the engine understands (used by the console). */
  meteredFeatures(): FeatureKey[] {
    return Object.keys(FEATURE_USAGE_SOURCE) as FeatureKey[];
  }

  /** Metrics known to the metering layer, for cross-checking feature wiring. */
  meteredMetrics(): readonly UsageMetric[] {
    return USAGE_METRICS;
  }

  /**
   * Evaluate one feature for a workspace.
   * `role` is optional: when present the matching RBAC permission is required too.
   */
  async evaluate(
    workspaceId: Types.ObjectId | string,
    feature: FeatureKey,
    options: { role?: WorkspaceRole | undefined } = {},
  ): Promise<EntitlementDecision> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const evaluatedAt = new Date().toISOString();
    const requiredPlan = MINIMUM_PLAN_FOR_FEATURE[feature];

    const rolePermission = FEATURE_PERMISSIONS[feature];
    if (options.role && rolePermission && !roleHasPermission(options.role, rolePermission)) {
      return {
        workspaceId: workspaceIdObj.toString(), feature, entitled: false, reason: 'ROLE_NOT_PERMITTED',
        plan: null, subscriptionStatus: null, packageId: null, requiredPlan,
        limit: null, used: null, remaining: null, evaluatedAt,
      };
    }

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj })
      .select('plan status')
      .lean();

    if (!subscription) {
      return {
        workspaceId: workspaceIdObj.toString(), feature, entitled: false, reason: 'NO_SUBSCRIPTION',
        plan: null, subscriptionStatus: null, packageId: null, requiredPlan,
        limit: null, used: null, remaining: null, evaluatedAt,
      };
    }

    const plan = subscription.plan as SubscriptionPlan;
    const status = subscription.status as SubscriptionStatus;
    const packageId = productPackagingService.packageForPlan(plan);

    if (status === 'CANCELLED' || status === 'EXPIRED') {
      return {
        workspaceId: workspaceIdObj.toString(), feature, entitled: false, reason: 'SUBSCRIPTION_INACTIVE',
        plan, subscriptionStatus: status, packageId, requiredPlan,
        limit: null, used: null, remaining: null, evaluatedAt,
      };
    }

    if (!this.planIncludes(plan, feature)) {
      return {
        workspaceId: workspaceIdObj.toString(), feature, entitled: false, reason: 'PLAN_UPGRADE_REQUIRED',
        plan, subscriptionStatus: status, packageId, requiredPlan,
        limit: null, used: null, remaining: null, evaluatedAt,
      };
    }

    const quota = await this.quotaFor(workspaceIdObj, feature, plan, packageId);
    if (quota && quota.exceeded) {
      return {
        workspaceId: workspaceIdObj.toString(), feature, entitled: false, reason: 'QUOTA_EXCEEDED',
        plan, subscriptionStatus: status, packageId, requiredPlan,
        limit: quota.limit, used: quota.used, remaining: 0, evaluatedAt,
      };
    }

    return {
      workspaceId: workspaceIdObj.toString(), feature, entitled: true, reason: 'ENTITLED',
      plan, subscriptionStatus: status, packageId, requiredPlan,
      limit: quota?.limit ?? null,
      used: quota?.used ?? null,
      remaining: quota?.remaining ?? null,
      evaluatedAt,
    };
  }

  /** Evaluate several features in one pass. */
  async evaluateMany(
    workspaceId: Types.ObjectId | string,
    features: readonly FeatureKey[],
    options: { role?: WorkspaceRole | undefined } = {},
  ): Promise<EntitlementDecision[]> {
    return Promise.all(features.map((feature) => this.evaluate(workspaceId, feature, options)));
  }

  /** Throws FEATURE_NOT_ENTITLED when the workspace is not entitled. */
  async assertFeature(
    workspaceId: Types.ObjectId | string,
    feature: FeatureKey,
    options: { role?: WorkspaceRole | undefined } = {},
  ): Promise<EntitlementDecision> {
    const decision = await this.evaluate(workspaceId, feature, options);
    if (!decision.entitled) {
      const error = new Error('FEATURE_NOT_ENTITLED') as Error & {
        feature?: string;
        reason?: EntitlementReason;
        requiredPlan?: SubscriptionPlan;
      };
      error.feature = feature;
      error.reason = decision.reason;
      error.requiredPlan = decision.requiredPlan;
      throw error;
    }
    return decision;
  }

  /** Full entitlement + quota picture for a workspace (customer console). */
  async getSummary(workspaceId: Types.ObjectId | string): Promise<EntitlementSummary> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj })
      .select('plan status')
      .lean();
    const plan = (subscription?.plan as SubscriptionPlan | undefined) ?? null;
    const status = (subscription?.status as SubscriptionStatus | undefined) ?? null;
    const packageId = plan ? productPackagingService.packageForPlan(plan) : null;

    let packageName: string | null = null;
    if (packageId) {
      const pkg = await productPackagingService.getProductPlan(packageId).catch(() => null);
      packageName = pkg?.name ?? null;
    }

    const included = plan ? PLAN_ENTITLEMENTS[plan] : [];
    const inactive = status === 'CANCELLED' || status === 'EXPIRED';
    const features = FEATURE_KEYS.map((feature) => {
      const entitled = plan !== null && !inactive && included.includes(feature);
      const reason: EntitlementReason = plan === null
        ? 'NO_SUBSCRIPTION'
        : inactive
          ? 'SUBSCRIPTION_INACTIVE'
          : included.includes(feature)
            ? 'ENTITLED'
            : 'PLAN_UPGRADE_REQUIRED';
      return { feature, entitled, reason, requiredPlan: MINIMUM_PLAN_FOR_FEATURE[feature] };
    });

    const quotas: FeatureQuotaSnapshot[] = [];
    for (const feature of this.meteredFeatures()) {
      const quota = await this.quotaFor(workspaceIdObj, feature, plan, packageId);
      if (quota) quotas.push(quota);
    }

    return {
      workspaceId: workspaceIdObj.toString(),
      plan,
      subscriptionStatus: status,
      packageId,
      packageName,
      features,
      quotas,
      upgradeTargets: features
        .filter((entry) => !entry.entitled)
        .map((entry) => entry.requiredPlan)
        .filter((value, index, all) => all.indexOf(value) === index),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Metered usage for the current month (null for boolean-only features). */
  private async quotaFor(
    workspaceId: Types.ObjectId,
    feature: FeatureKey,
    plan: SubscriptionPlan | null,
    packageId: ProductPackageId | null,
  ): Promise<FeatureQuotaSnapshot | null> {
    const source = FEATURE_USAGE_SOURCE[feature];
    if (!source) return null;

    const packaged = packageId
      ? await productPackagingService.getProductPlan(packageId).catch(() => null)
      : null;
    const fallbackLimits = plan ? PLAN_LIMITS[plan] : null;

    let limit: number | null = null;
    if (feature === 'WORKFLOWS') {
      limit = packaged?.packaging.includedWorkflows ?? fallbackLimits?.workflows ?? null;
    } else if (feature === 'EXECUTIONS') {
      limit = packaged?.packaging.executionLimit ?? fallbackLimits?.executionsPerMonth ?? null;
    } else if (feature === 'AI_REQUESTS') {
      limit = packaged?.packaging.aiRequestLimit ?? null;
    } else if (feature === 'AI_AGENTS') {
      limit = packaged?.packaging.agentLimit ?? null;
    }

    let used: number;
    if (source.kind === 'count') {
      used = source.collection === 'workflows'
        ? await WorkflowModel.countDocuments({ workspaceId })
        : await AgentModel.countDocuments({ workspaceId, status: { $in: ['DRAFT', 'ACTIVE', 'PAUSED'] } });
    } else {
      const periodKey = monthPeriodKey(new Date());
      const bucket = await UsageMeterModel.findOne({
        workspaceId,
        metric: source.metric,
        granularity: 'MONTH',
        periodKey,
      }).select('value').lean();
      used = bucket?.value ?? 0;
    }

    const limitValue = typeof limit === 'number' && limit > 0 ? limit : null;
    return {
      feature,
      limit: limitValue,
      used,
      remaining: limitValue === null ? null : Math.max(0, limitValue - used),
      percent: limitValue === null ? null : Math.round((used / limitValue) * 1000) / 10,
      exceeded: limitValue === null ? false : used >= limitValue,
    };
  }
}

export const featureEntitlementService = new FeatureEntitlementService();


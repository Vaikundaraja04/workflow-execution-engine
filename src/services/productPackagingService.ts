import {
  ProductPlanModel,
  DEFAULT_PRODUCT_PLANS,
  PRODUCT_PACKAGE_IDS,
  ensureDefaultProductPlans,
} from '../models/ProductPlanModel.js';
import type { ProductPackageId, IProductPlan, ProductPackaging } from '../models/ProductPlanModel.js';
import type { SubscriptionPlan } from '../models/SubscriptionModel.js';

/**
 * Phase 14.1 - Product package catalog and plan comparison.
 *
 * The catalog is the commercially sellable view of the internal plan grid:
 * Starter -> STARTER, Business -> PROFESSIONAL, Enterprise -> ENTERPRISE.
 */

/** Internal plan -> sellable package. FREE has no package (self-serve entry tier). */
export const PACKAGE_BY_PLAN: Record<SubscriptionPlan, ProductPackageId | null> = {
  FREE: null,
  STARTER: 'STARTER',
  PROFESSIONAL: 'BUSINESS',
  ENTERPRISE: 'ENTERPRISE',
};

/** Sellable package -> internal plan (inverse of PACKAGE_BY_PLAN). */
export const PLAN_BY_PACKAGE: Record<ProductPackageId, SubscriptionPlan> = {
  STARTER: 'STARTER',
  BUSINESS: 'PROFESSIONAL',
  ENTERPRISE: 'ENTERPRISE',
};

/** Accepts the package id or the internal plan name (BUSINESS <-> PROFESSIONAL). */
export function resolvePackageId(input: string): ProductPackageId {
  const normalized = input.trim().toUpperCase();
  switch (normalized) {
    case 'STARTER':
      return 'STARTER';
    case 'BUSINESS':
    case 'PROFESSIONAL':
      return 'BUSINESS';
    case 'ENTERPRISE':
      return 'ENTERPRISE';
    default:
      throw new Error('PRODUCT_PLAN_NOT_FOUND');
  }
}

export interface PlanComparison {
  from: { packageId: ProductPackageId; name: string; priceMonthly: number; currency: string };
  to: { packageId: ProductPackageId; name: string; priceMonthly: number; currency: string };
  priceDeltaPercent: number;
  upgrade: boolean;
  limitDeltas: Array<{
    field: keyof ProductPackaging;
    from: number | string | null;
    to: number | string | null;
    delta: number | null;
  }>;
  entitlementsAdded: string[];
  entitlementsRemoved: string[];
  recommended: boolean;
}

const NUMERIC_PACKAGING_FIELDS: Array<keyof ProductPackaging> = [
  'includedWorkflows',
  'executionLimit',
  'aiRequestLimit',
  'agentLimit',
  'storageBytes',
  'seats',
  'supportResponseHours',
];

export class ProductPackagingService {
  /** Return the active catalog, seeding the defaults on first use. */
  async listProductPlans(options: { includeInactive?: boolean } = {}): Promise<IProductPlan[]> {
    const query = options.includeInactive ? {} : { isActive: true };
    let plans = await ProductPlanModel.find(query).sort({ sortOrder: 1, priceMonthly: 1 });
    if (plans.length === 0 && !options.includeInactive) {
      await ensureDefaultProductPlans();
      plans = await ProductPlanModel.find(query).sort({ sortOrder: 1, priceMonthly: 1 });
    }
    return plans;
  }

  async getProductPlan(packageId: string): Promise<IProductPlan> {
    const id = resolvePackageId(packageId);
    let plan = await ProductPlanModel.findOne({ id });
    if (!plan) {
      await ensureDefaultProductPlans();
      plan = await ProductPlanModel.findOne({ id });
    }
    if (!plan) throw new Error('PRODUCT_PLAN_NOT_FOUND');
    return plan;
  }

  /** Marketing entry tier that has no sellable package. */
  getFreeTierSummary() {
    return {
      packageId: null,
      name: 'Free',
      priceMonthly: 0,
      currency: 'USD',
      internalPlan: 'FREE' as SubscriptionPlan,
    };
  }

  packageForPlan(plan: SubscriptionPlan): ProductPackageId | null {
    return PACKAGE_BY_PLAN[plan] ?? null;
  }

  /** Compare two packages and describe what an upgrade or downgrade changes. */
  async compareProductPlans(from: string, to: string): Promise<PlanComparison> {
    const [fromPlan, toPlan] = await Promise.all([
      this.getProductPlan(from),
      this.getProductPlan(to),
    ]);

    const limitDeltas = NUMERIC_PACKAGING_FIELDS.map((field) => {
      const fromValue = fromPlan.packaging[field] as number | null;
      const toValue = toPlan.packaging[field] as number | null;
      return {
        field,
        from: fromValue,
        to: toValue,
        delta: typeof fromValue === 'number' && typeof toValue === 'number' ? toValue - fromValue : null,
      };
    });

    const fromEntitlements = new Set(fromPlan.entitlements);
    const toEntitlements = new Set(toPlan.entitlements);
    const entitlementsAdded = toPlan.entitlements.filter((feature) => !fromEntitlements.has(feature));
    const entitlementsRemoved = fromPlan.entitlements.filter((feature) => !toEntitlements.has(feature));
    const upgrade = toPlan.sortOrder > fromPlan.sortOrder;
    const priceDeltaPercent = fromPlan.priceMonthly > 0
      ? Math.round(((toPlan.priceMonthly - fromPlan.priceMonthly) / fromPlan.priceMonthly) * 1000) / 10
      : toPlan.priceMonthly > 0
        ? 100
        : 0;

    return {
      from: {
        packageId: fromPlan.id,
        name: fromPlan.name,
        priceMonthly: fromPlan.priceMonthly,
        currency: fromPlan.currency,
      },
      to: {
        packageId: toPlan.id,
        name: toPlan.name,
        priceMonthly: toPlan.priceMonthly,
        currency: toPlan.currency,
      },
      priceDeltaPercent,
      upgrade,
      limitDeltas,
      entitlementsAdded,
      entitlementsRemoved,
      recommended: upgrade && entitlementsAdded.length > 0,
    };
  }

  isPackageId(value: string): value is ProductPackageId {
    return (PRODUCT_PACKAGE_IDS as readonly string[]).includes(value.trim().toUpperCase());
  }

  /** Package seed used by tests and by catalog migrations. */
  defaultPackaging(packageId: ProductPackageId): ProductPackaging {
    return DEFAULT_PRODUCT_PLANS[packageId].packaging;
  }

  packageWorkspace(packageId: string, useCase: string): { sellablePlan: SubscriptionPlan; sellablePackageId: ProductPackageId; packaging: ProductPackaging; useCase: string } {
    const resolvedPackageId = this.isPackageId(packageId) ? packageId.trim().toUpperCase() as ProductPackageId : 'STARTER';
    const plan = PLAN_BY_PACKAGE[resolvedPackageId];
    const packaging = this.defaultPackaging(resolvedPackageId);
    return { sellablePlan: plan, sellablePackageId: resolvedPackageId, packaging, useCase };
  }
}

export const productPackagingService = new ProductPackagingService();

import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionStatus } from '../models/SubscriptionModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { conversionTrackingService } from './conversionTrackingService.js';
import type { FunnelReport } from './conversionTrackingService.js';
import { productPackagingService } from './productPackagingService.js';
import { customerHealthService } from './customerHealthService.js';
import type { IProductPlan, ProductPackageId } from '../models/ProductPlanModel.js';

/**
 * Phase 15.8 - Business analytics dashboard.
 *
 * Reads the funnel through MRR and churn from data the platform already owns:
 * ConversionEventModel for acquisition, the packaged catalog priced against
 * SubscriptionModel for revenue, TenantAccountModel for the customer base and
 * customerHealthService for the risk overlay. Nothing is estimated - a metric
 * the data cannot answer is reported as zero.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'TRIALING'];
const CHURNED_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['EXPIRED', 'CANCELLED'];
const TRIAL_ENDING_WINDOW_DAYS = 7;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const MAX_PRICED_SUBSCRIPTIONS = 5000;

export interface PlanMixEntry {
  packageId: ProductPackageId;
  name: string;
  subscriptions: number;
  mrr: number;
  sharePercent: number;
}

export interface BusinessAnalyticsReport {
  window: { since: string; until: string; days: number };
  acquisition: {
    visitors: number;
    signups: number;
    demos: number;
    subscriptions: number;
    visitToSignupPercent: number;
    signupToSubscriptionPercent: number;
    visitToSubscriptionPercent: number;
    bySource: FunnelReport['bySource'];
  };
  revenue: {
    currency: string;
    mrr: number;
    arr: number;
    arpa: number;
    payingCustomers: number;
    trialingCustomers: number;
    planMix: PlanMixEntry[];
  };
  customers: {
    active: number;
    newInWindow: number;
    trialsEndingSoon: number;
    churned: number;
    startingBase: number;
    churnRatePercent: number;
  };
  health: {
    evaluated: number;
    healthy: number;
    watch: number;
    atRisk: number;
  };
  generatedAt: string;
}
function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function normalizeDays(days: number | undefined): number {
  if (!Number.isFinite(days) || !days || days <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.floor(days));
}

export class BusinessAnalyticsService {
  /** The whole funnel plus revenue, customers and health for one window. */
  async report(options: { days?: number | undefined; now?: Date | undefined } = {}): Promise<BusinessAnalyticsReport> {
    const days = normalizeDays(options.days);
    const until = options.now ?? new Date();
    const since = new Date(until.getTime() - days * MS_PER_DAY);
    const trialHorizon = new Date(until.getTime() + TRIAL_ENDING_WINDOW_DAYS * MS_PER_DAY);

    const [funnel, plans, activeSubscriptions, churned, newInWindow, trialsEndingSoon, health] = await Promise.all([
      conversionTrackingService.funnel({ days, now: until }),
      productPackagingService.listProductPlans(),
      SubscriptionModel.find({ status: { $in: ACTIVE_SUBSCRIPTION_STATUSES } })
        .select('workspaceId plan status')
        .limit(MAX_PRICED_SUBSCRIPTIONS)
        .lean(),
      SubscriptionModel.countDocuments({
        status: { $in: CHURNED_SUBSCRIPTION_STATUSES },
        updatedAt: { $gte: since, $lte: until },
      }),
      TenantAccountModel.countDocuments({
        demo: false,
        status: { $nin: ['SUSPENDED', 'CLOSED'] },
        createdAt: { $gte: since, $lte: until },
      }),
      TenantAccountModel.countDocuments({
        demo: false,
        status: 'TRIALING',
        trialEndsAt: { $gte: until, $lte: trialHorizon },
      }),
      customerHealthService.portfolio({ limit: 200, now: until }),
    ]);

    const active = await this.countActiveCustomers(
      activeSubscriptions.map((subscription) => subscription.workspaceId.toString()),
    );
    const revenue = this.buildRevenue(plans, activeSubscriptions);
    const startingBase = Math.max(1, active + churned - newInWindow);
    return {
      window: { since: since.toISOString(), until: until.toISOString(), days },
      acquisition: {
        visitors: funnel.totals.visitors,
        signups: funnel.totals.signups,
        demos: funnel.totals.demos,
        subscriptions: funnel.totals.subscriptions,
        visitToSignupPercent: funnel.rates.visitToSignupPercent,
        signupToSubscriptionPercent: funnel.rates.signupToSubscriptionPercent,
        visitToSubscriptionPercent: funnel.rates.visitToSubscriptionPercent,
        bySource: funnel.bySource,
      },
      revenue,
      customers: {
        active,
        newInWindow,
        trialsEndingSoon,
        churned,
        startingBase,
        churnRatePercent: percent(churned, startingBase),
      },
      health: {
        evaluated: health.summary.total,
        healthy: health.summary.healthy,
        watch: health.summary.watch,
        atRisk: health.summary.atRisk,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Non-demo, non-suspended tenants that currently hold a subscription. */
  private async countActiveCustomers(workspaceIds: string[]): Promise<number> {
    if (workspaceIds.length === 0) return 0;
    return TenantAccountModel.countDocuments({
      workspaceId: { $in: workspaceIds },
      demo: false,
      status: { $nin: ['SUSPENDED', 'CLOSED'] },
    });
  }

  /** MRR/ARR/ARPA and the plan mix, priced from the packaged catalog. */
  private buildRevenue(
    plans: IProductPlan[],
    subscriptions: Array<{ plan: string; status: string }>,
  ): BusinessAnalyticsReport['revenue'] {
    const priceByPlan = new Map<string, { plan: IProductPlan; packageId: ProductPackageId }>();
    for (const plan of plans) priceByPlan.set(plan.internalPlan, { plan, packageId: plan.id });
    const byPackage = new Map<ProductPackageId, { name: string; subscriptions: number; mrr: number }>();
    let mrr = 0;
    let payingCustomers = 0;
    let trialingCustomers = 0;

    for (const subscription of subscriptions) {
      const priced = priceByPlan.get(subscription.plan);
      if (!priced) continue;
      const entry = byPackage.get(priced.packageId) ?? { name: priced.plan.name, subscriptions: 0, mrr: 0 };
      entry.subscriptions += 1;
      entry.mrr += priced.plan.priceMonthly;
      byPackage.set(priced.packageId, entry);
      mrr += priced.plan.priceMonthly;
      payingCustomers += 1;
      if (subscription.status === 'TRIALING') trialingCustomers += 1;
    }
    const planMix: PlanMixEntry[] = [...byPackage.entries()]
      .map(([packageId, entry]) => ({
        packageId,
        name: entry.name,
        subscriptions: entry.subscriptions,
        mrr: entry.mrr,
        sharePercent: percent(entry.mrr, mrr),
      }))
      .sort((a, b) => b.mrr - a.mrr);

    return {
      currency: plans[0]?.currency ?? 'USD',
      mrr,
      arr: mrr * 12,
      arpa: payingCustomers > 0 ? Math.round(mrr / payingCustomers) : 0,
      payingCustomers,
      trialingCustomers,
      planMix,
    };
  }
}

export const businessAnalyticsService = new BusinessAnalyticsService();
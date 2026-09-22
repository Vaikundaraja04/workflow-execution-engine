import { Types } from 'mongoose';
import { GrowthEventModel, GROWTH_FUNNEL_ORDER } from '../models/GrowthEventModel.js';
import type { GrowthEventName } from '../models/GrowthEventModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { productPackagingService } from './productPackagingService.js';

/**
 * Phase 16.1 - Growth analytics.
 *
 * Computes the acquisition funnel, per-source conversion (with CAC when
 * marketing spend is supplied) and cohort retention from the growth event
 * ledger and real execution activity. Nothing is estimated: a number the data
 * cannot support is reported as null with the reason.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_COHORT_MONTHS = 6;
const MAX_COHORT_MONTHS = 12;
const ACTIVATION_WINDOW_DAYS = 14;
const MAX_ACTIVATION_SAMPLES = 250;
const MAX_COHORT_WORKSPACES = 500;

export interface RecordGrowthInput {
  event: GrowthEventName;
  workspaceId?: string | null | undefined;
  leadId?: string | null | undefined;
  userId?: string | null | undefined;
  partnerId?: string | null | undefined;
  plan?: string | null | undefined;
  packageId?: string | null | undefined;
  source?: string | null | undefined;
  anonymousId?: string | null | undefined;
  amount?: number | null | undefined;
  currency?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  occurredAt?: Date | undefined;
}

export interface GrowthFunnelStep {
  event: GrowthEventName;
  count: number;
  conversionFromPrevious: number | null;
  conversionFromStart: number | null;
}

export interface GrowthFunnelReport {
  window: { since: string; until: string; days: number };
  steps: GrowthFunnelStep[];
  totals: {
    visitors: number;
    signups: number;
    demos: number;
    trials: number;
    payments: number;
    customers: number;
    churned: number;
  };
  rates: {
    visitorToSignupPercent: number;
    signupToDemoPercent: number;
    demoToCustomerPercent: number;
    trialToCustomerPercent: number;
    visitorToCustomerPercent: number;
    customerToChurnPercent: number;
  };
  bySource: Array<{
    source: string;
    visitors: number;
    signups: number;
    demos: number;
    customers: number;
    conversionPercent: number;
  }>;
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

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function normalizeMonths(months: number | undefined): number {
  if (!Number.isFinite(months) || !months || months <= 0) return DEFAULT_COHORT_MONTHS;
  return Math.min(MAX_COHORT_MONTHS, Math.floor(months));
}

export interface GrowthConversionReport {
  window: { since: string; until: string; days: number };
  bySource: Array<{
    source: string;
    visitors: number;
    signups: number;
    customers: number;
    signupPercent: number;
    customerPercent: number;
  }>;
  cac: {
    spend: number | null;
    currency: string;
    customersAcquired: number;
    costPerAcquisition: number | null;
    note: string;
  };
  activation: {
    windowDays: number;
    evaluated: number;
    activated: number;
    activationRatePercent: number;
    note: string;
  };
  rates: {
    signupToDemoPercent: number;
    demoToCustomerPercent: number;
    trialToPaidPercent: number;
  };
  generatedAt: string;
}

export interface RetentionCohort {
  cohortMonth: string;
  size: number;
  retained: Array<{ monthOffset: number; active: number; percent: number }>;
}

export interface GrowthRetentionReport {
  window: { months: number; since: string; until: string };
  cohorts: RetentionCohort[];
  churn: {
    churnedInWindow: number;
    startingBase: number;
    churnRatePercent: number;
    note: string;
  };
  ltv: {
    arpa: number | null;
    churnRatePercent: number;
    estimatedLifetimeMonths: number | null;
    note: string;
  };
  generatedAt: string;
}

export class GrowthAnalyticsService {
  /** Append one lifecycle event. */
  async record(input: RecordGrowthInput): Promise<{ event: GrowthEventName; occurredAt: Date }> {
    const occurredAt = input.occurredAt ?? new Date();
    await GrowthEventModel.create({
      event: input.event,
      workspaceId: input.workspaceId ? new Types.ObjectId(input.workspaceId) : null,
      leadId: input.leadId ? new Types.ObjectId(input.leadId) : null,
      userId: input.userId ? new Types.ObjectId(input.userId) : null,
      partnerId: input.partnerId ? new Types.ObjectId(input.partnerId) : null,
      plan: input.plan ?? null,
      packageId: input.packageId ?? null,
      source: input.source ?? null,
      anonymousId: input.anonymousId ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      metadata: input.metadata,
      occurredAt,
    });
    return { event: input.event, occurredAt };
  }

  /** Non-throwing wrapper for lifecycle hooks that must not break the caller. */
  async recordSafely(input: RecordGrowthInput): Promise<{ recorded: boolean }> {
    try {
      await this.record(input);
      return { recorded: true };
    } catch {
      return { recorded: false };
    }
  }

  /** Duplicate-safe hook: skips a lifecycle event already recorded for a workspace. */
  async recordOnce(input: RecordGrowthInput): Promise<{ recorded: boolean; duplicate: boolean }> {
    try {
      if (input.workspaceId) {
        const existing = await GrowthEventModel.exists({
          event: input.event,
          workspaceId: new Types.ObjectId(input.workspaceId),
        });
        if (existing) return { recorded: false, duplicate: true };
      }
      await this.record(input);
      return { recorded: true, duplicate: false };
    } catch {
      return { recorded: false, duplicate: false };
    }
  }

  /** Acquisition funnel: step counts and step-to-step conversion. */
  async funnel(options: { days?: number | undefined; source?: string | undefined; now?: Date | undefined } = {}): Promise<GrowthFunnelReport> {
    const days = normalizeDays(options.days);
    const until = options.now ?? new Date();
    const since = new Date(until.getTime() - days * MS_PER_DAY);

    const match: Record<string, unknown> = { occurredAt: { $gte: since, $lte: until } };
    if (options.source) match.source = options.source;

    const grouped = await GrowthEventModel.aggregate<{ _id: GrowthEventName; count: number }>([
      { $match: match },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);
    const counts = new Map(grouped.map((entry) => [entry._id, entry.count]));

    const startCount = counts.get('LANDING_VIEW') ?? 0;
    const steps: GrowthFunnelStep[] = GROWTH_FUNNEL_ORDER.map((event, index) => {
      const count = counts.get(event) ?? 0;
      const previous = index === 0
        ? null
        : counts.get(GROWTH_FUNNEL_ORDER[index - 1] as GrowthEventName) ?? 0;
      return {
        event,
        count,
        conversionFromPrevious: previous === null ? null : percent(count, previous),
        conversionFromStart: percent(count, startCount),
      };
    });

    const signups = counts.get('SIGNUP_COMPLETED') ?? 0;
    const demos = counts.get('DEMO_STARTED') ?? 0;
    const trials = counts.get('TRIAL_STARTED') ?? 0;
    const payments = counts.get('PAYMENT_COMPLETED') ?? 0;
    const customers = counts.get('CUSTOMER_CONVERTED') ?? 0;
    const churned = counts.get('CUSTOMER_CHURNED') ?? 0;

    const bySourceRaw = await GrowthEventModel.aggregate<{
      _id: string;
      visitors: number;
      signups: number;
      demos: number;
      customers: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$source', 'unknown'] },
          visitors: { $sum: { $cond: [{ $eq: ['$event', 'LANDING_VIEW'] }, 1, 0] } },
          signups: { $sum: { $cond: [{ $eq: ['$event', 'SIGNUP_COMPLETED'] }, 1, 0] } },
          demos: { $sum: { $cond: [{ $eq: ['$event', 'DEMO_STARTED'] }, 1, 0] } },
          customers: { $sum: { $cond: [{ $eq: ['$event', 'CUSTOMER_CONVERTED'] }, 1, 0] } },
        },
      },
      { $sort: { visitors: -1 } },
      { $limit: 25 },
    ]);

    return {
      window: { since: since.toISOString(), until: until.toISOString(), days },
      steps,
      totals: { visitors: startCount, signups, demos, trials, payments, customers, churned },
      rates: {
        visitorToSignupPercent: percent(signups, startCount),
        signupToDemoPercent: percent(demos, signups),
        demoToCustomerPercent: percent(customers, demos),
        trialToCustomerPercent: percent(customers, trials),
        visitorToCustomerPercent: percent(customers, startCount),
        customerToChurnPercent: percent(churned, Math.max(customers, churned)),
      },
      bySource: bySourceRaw.map((entry) => ({
        source: entry._id,
        visitors: entry.visitors,
        signups: entry.signups,
        demos: entry.demos,
        customers: entry.customers,
        conversionPercent: percent(entry.customers, entry.visitors),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Per-source conversion, CAC (when spend is supplied) and activation. */
  async conversion(options: {
    days?: number | undefined;
    spend?: number | undefined;
    currency?: string | undefined;
    now?: Date | undefined;
  } = {}): Promise<GrowthConversionReport> {
    const days = normalizeDays(options.days);
    const until = options.now ?? new Date();
    const since = new Date(until.getTime() - days * MS_PER_DAY);
    const currency = (options.currency ?? 'USD').toUpperCase();

    const [funnelReport, sourceRows] = await Promise.all([
      this.funnel({ days, now: until }),
      GrowthEventModel.aggregate<{ _id: string; visitors: number; signups: number; customers: number }>([
        { $match: { occurredAt: { $gte: since, $lte: until } } },
        {
          $group: {
            _id: { $ifNull: ['$source', 'unknown'] },
            visitors: { $sum: { $cond: [{ $eq: ['$event', 'LANDING_VIEW'] }, 1, 0] } },
            signups: { $sum: { $cond: [{ $eq: ['$event', 'SIGNUP_COMPLETED'] }, 1, 0] } },
            customers: { $sum: { $cond: [{ $eq: ['$event', 'CUSTOMER_CONVERTED'] }, 1, 0] } },
          },
        },
        { $sort: { customers: -1, signups: -1 } },
        { $limit: 25 },
      ]),
    ]);

    const customersAcquired = funnelReport.totals.customers;
    const spend = typeof options.spend === 'number' && Number.isFinite(options.spend) && options.spend >= 0
      ? Math.floor(options.spend)
      : null;
    const activation = await this.activationFor(since, until);

    return {
      window: { since: since.toISOString(), until: until.toISOString(), days },
      bySource: sourceRows.map((entry) => ({
        source: entry._id,
        visitors: entry.visitors,
        signups: entry.signups,
        customers: entry.customers,
        signupPercent: percent(entry.signups, entry.visitors),
        customerPercent: percent(entry.customers, entry.signups),
      })),
      cac: {
        spend,
        currency,
        customersAcquired,
        costPerAcquisition: spend === null || customersAcquired <= 0
          ? null
          : Math.round(spend / customersAcquired),
        note: spend === null
          ? 'Marketing spend was not supplied - pass ?spend=<smallest unit> to compute CAC'
          : customersAcquired === 0
            ? 'No customers converted in this window'
            : 'CAC = supplied spend / customers converted in the window',
      },
      activation,
      rates: {
        signupToDemoPercent: funnelReport.rates.signupToDemoPercent,
        demoToCustomerPercent: funnelReport.rates.demoToCustomerPercent,
        trialToPaidPercent: funnelReport.rates.trialToCustomerPercent,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Activation = first workflow execution within the activation window of signup. */
  private async activationFor(since: Date, until: Date): Promise<GrowthConversionReport['activation']> {
    const signups = await GrowthEventModel.find({
      event: 'SIGNUP_COMPLETED',
      workspaceId: { $ne: null },
      occurredAt: { $gte: since, $lte: until },
    })
      .sort({ occurredAt: -1 })
      .limit(MAX_ACTIVATION_SAMPLES)
      .select('workspaceId occurredAt')
      .lean();

    if (signups.length === 0) {
      return {
        windowDays: ACTIVATION_WINDOW_DAYS,
        evaluated: 0,
        activated: 0,
        activationRatePercent: 0,
        note: 'No signups in this window',
      };
    }

    const workspaceIds = signups
      .map((signup) => signup.workspaceId as Types.ObjectId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    const earliest = Math.min(...signups.map((signup) => signup.occurredAt.getTime()));

    const firstExecutions = await WorkflowExecutionModel.aggregate<{ _id: Types.ObjectId; first: Date }>([
      { $match: { workspaceId: { $in: workspaceIds }, createdAt: { $gte: new Date(earliest), $lte: until } } },
      { $group: { _id: '$workspaceId', first: { $min: '$createdAt' } } },
    ]);
    const firstByWorkspace = new Map(
      firstExecutions.map((entry) => [entry._id.toString(), entry.first]),
    );

    let activated = 0;
    for (const signup of signups) {
      const workspaceKey = (signup.workspaceId as Types.ObjectId).toString();
      const first = firstByWorkspace.get(workspaceKey);
      if (!first) continue;
      const deadline = signup.occurredAt.getTime() + ACTIVATION_WINDOW_DAYS * MS_PER_DAY;
      if (new Date(first).getTime() <= deadline) activated += 1;
    }

    return {
      windowDays: ACTIVATION_WINDOW_DAYS,
      evaluated: signups.length,
      activated,
      activationRatePercent: percent(activated, signups.length),
      note: 'Activated = first workflow execution within 14 days of signup',
    };
  }

  /** Monthly cohorts with retention (workspace had execution activity that month). */
  async retention(options: { months?: number | undefined; now?: Date | undefined } = {}): Promise<GrowthRetentionReport> {
    const months = normalizeMonths(options.months);
    const until = options.now ?? new Date();
    const since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() - (months - 1), 1));

    const signups = await GrowthEventModel.find({
      event: 'SIGNUP_COMPLETED',
      workspaceId: { $ne: null },
      occurredAt: { $gte: since, $lte: until },
    })
      .select('workspaceId occurredAt')
      .limit(MAX_COHORT_WORKSPACES)
      .lean();

    const cohorts = new Map<string, Set<string>>();
    for (const signup of signups) {
      const key = monthKey(signup.occurredAt);
      const cohort = cohorts.get(key) ?? new Set<string>();
      cohort.add((signup.workspaceId as Types.ObjectId).toString());
      cohorts.set(key, cohort);
    }

    const workspaceIds = [...new Set(signups.map((signup) => (signup.workspaceId as Types.ObjectId).toString()))]
      .map((id) => new Types.ObjectId(id));

    const activity = workspaceIds.length === 0
      ? []
      : await WorkflowExecutionModel.aggregate<{ _id: { workspaceId: Types.ObjectId; month: string } }>([
        { $match: { workspaceId: { $in: workspaceIds }, createdAt: { $gte: since, $lte: until } } },
        { $group: { _id: { workspaceId: '$workspaceId', month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } } } } },
      ]);
    const activeSet = new Set(activity.map((row) => `${row._id.workspaceId.toString()}:${row._id.month}`));
    const currentMonth = monthKey(until);

    const result: RetentionCohort[] = [...cohorts.keys()].sort().map((cohortMonth) => {
      const cohort = cohorts.get(cohortMonth) as Set<string>;
      const [year, month] = cohortMonth.split('-').map(Number) as [number, number];
      const retained: RetentionCohort['retained'] = [];
      for (let offset = 0; offset < months; offset += 1) {
        const cursor = new Date(Date.UTC(year, month - 1 + offset, 1));
        const cursorKey = monthKey(cursor);
        if (cursorKey > currentMonth) break;
        const active = [...cohort].filter((workspaceId) => activeSet.has(`${workspaceId}:${cursorKey}`)).length;
        retained.push({ monthOffset: offset, active, percent: percent(active, cohort.size) });
      }
      return { cohortMonth, size: cohort.size, retained };
    });

    const churnedInWindow = await GrowthEventModel.countDocuments({
      event: 'CUSTOMER_CHURNED',
      occurredAt: { $gte: since, $lte: until },
    });
    const baseWorkspaces = await GrowthEventModel.distinct('workspaceId', {
      event: 'CUSTOMER_CONVERTED',
      occurredAt: { $lt: since },
      workspaceId: { $ne: null },
    });
    const startingBase = baseWorkspaces.length;
    const churnRatePercent = percent(churnedInWindow, Math.max(startingBase, 1));

    const [plans, subscriptionCounts] = await Promise.all([
      productPackagingService.listProductPlans(),
      SubscriptionModel.aggregate<{ _id: string; count: number }>([
        { $match: { status: { $in: ['ACTIVE', 'TRIALING'] } } },
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]),
    ]);
    const priceByPlan = new Map<string, number>(plans.map((plan) => [String(plan.internalPlan), plan.priceMonthly]));
    let mrr = 0;
    let payingCustomers = 0;
    for (const row of subscriptionCounts) {
      const price = priceByPlan.get(row._id);
      if (price === undefined) continue;
      mrr += price * row.count;
      payingCustomers += row.count;
    }
    const arpa = payingCustomers > 0 ? Math.round(mrr / payingCustomers) : null;

    return {
      window: { months, since: since.toISOString(), until: until.toISOString() },
      cohorts: result,
      churn: {
        churnedInWindow,
        startingBase,
        churnRatePercent,
        note: 'Starting base = workspaces converted before the window; churn counts CUSTOMER_CHURNED events inside it',
      },
      ltv: {
        arpa,
        churnRatePercent,
        estimatedLifetimeMonths: churnRatePercent > 0
          ? Math.round((100 / churnRatePercent) * 10) / 10
          : null,
        note: churnRatePercent > 0
          ? 'Lifetime months = 100 / churn rate; LTV value = ARPA x lifetime months'
          : 'LTV cannot be estimated without a non-zero churn rate',
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

export const growthAnalyticsService = new GrowthAnalyticsService();

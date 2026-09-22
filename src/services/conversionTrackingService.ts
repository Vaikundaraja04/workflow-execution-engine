import { Types } from 'mongoose';
import {
  ConversionEventModel,
  CONVERSION_FUNNEL_ORDER,
} from '../models/ConversionEventModel.js';
import type { ConversionEventName } from '../models/ConversionEventModel.js';

/**
 * Phase 14.9 - Marketing conversion tracking.
 *
 * Records the acquisition funnel (landing -> signup -> demo -> subscription) and
 * reports step conversion. Events are analytics data, so they are intentionally
 * NOT written to the hash-chained audit log (which stays for security-relevant
 * mutations) and never store credentials or payload bodies.
 */

export interface RecordConversionInput {
  event: ConversionEventName;
  workspaceId?: string | null | undefined;
  leadId?: string | null | undefined;
  userId?: string | null | undefined;
  plan?: string | null | undefined;
  packageId?: string | null | undefined;
  source?: string | null | undefined;
  anonymousId?: string | null | undefined;
  utm?: Record<string, string> | undefined;
  occurredAt?: Date | undefined;
}

export interface FunnelStep {
  event: ConversionEventName;
  count: number;
  conversionFromPrevious: number | null;
  conversionFromStart: number | null;
}

export interface FunnelReport {
  window: { since: string; until: string; days: number };
  steps: FunnelStep[];
  totals: { visitors: number; signups: number; demos: number; subscriptions: number };
  rates: {
    visitToSignupPercent: number;
    signupToSubscriptionPercent: number;
    visitToSubscriptionPercent: number;
  };
  bySource: Array<{ source: string; landing: number; signups: number; subscriptions: number }>;
  generatedAt: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export class ConversionTrackingService {
  /** Append a funnel event. */
  async record(input: RecordConversionInput): Promise<{ event: ConversionEventName; occurredAt: Date }> {
    const occurredAt = input.occurredAt ?? new Date();
    await ConversionEventModel.create({
      event: input.event,
      workspaceId: input.workspaceId ? new Types.ObjectId(input.workspaceId) : null,
      leadId: input.leadId ? new Types.ObjectId(input.leadId) : null,
      userId: input.userId ? new Types.ObjectId(input.userId) : null,
      plan: input.plan ?? null,
      packageId: input.packageId ?? null,
      source: input.source ?? null,
      anonymousId: input.anonymousId ?? null,
      utm: input.utm,
      occurredAt,
    });
    return { event: input.event, occurredAt };
  }

  /** Non-throwing wrapper for lifecycle hooks that must not break the caller. */
  async recordSafely(input: RecordConversionInput): Promise<{ recorded: boolean }> {
    try {
      await this.record(input);
      return { recorded: true };
    } catch {
      return { recorded: false };
    }
  }

  /** Convenience hooks used by the landing page, signup, demo and billing flows. */
  async recordLandingView(input: { source?: string | undefined; anonymousId?: string | undefined; utm?: Record<string, string> | undefined }) {
    return this.recordSafely({
      event: 'LANDING_VIEW',
      source: input.source ?? null,
      anonymousId: input.anonymousId ?? null,
      utm: input.utm,
    });
  }

  async recordSignupStarted(input: { source?: string | undefined; anonymousId?: string | undefined; utm?: Record<string, string> | undefined } = {}) {
    return this.recordSafely({
      event: 'SIGNUP_STARTED',
      source: input.source ?? null,
      anonymousId: input.anonymousId ?? null,
      utm: input.utm,
    });
  }

  async recordSignupCompleted(input: {
    workspaceId: string;
    userId?: string | undefined;
    plan?: string | undefined;
    source?: string | undefined;
  }) {
    return this.recordSafely({
      event: 'SIGNUP_COMPLETED',
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      plan: input.plan ?? null,
      source: input.source ?? null,
    });
  }

  async recordDemoCreated(input: { workspaceId: string; leadId?: string | undefined; source?: string | undefined }) {
    return this.recordSafely({
      event: 'DEMO_CREATED',
      workspaceId: input.workspaceId,
      leadId: input.leadId ?? null,
      source: input.source ?? 'DEMO_REQUEST',
    });
  }

  async recordSubscriptionStarted(input: {
    workspaceId: string;
    plan: string;
    packageId?: string | null | undefined;
    source?: string | undefined;
  }) {
    return this.recordSafely({
      event: 'SUBSCRIPTION_STARTED',
      workspaceId: input.workspaceId,
      plan: input.plan,
      packageId: input.packageId ?? null,
      source: input.source ?? 'CHECKOUT',
    });
  }

  /** Funnel report with step conversion and source attribution. */
  async funnel(options: { days?: number; source?: string | undefined; now?: Date | undefined } = {}): Promise<FunnelReport> {
    const days = Number.isFinite(options.days) && options.days && options.days > 0
      ? Math.min(365, Math.floor(options.days))
      : 30;
    const until = options.now ?? new Date();
    const since = new Date(until.getTime() - days * MS_PER_DAY);

    const match: Record<string, unknown> = { occurredAt: { $gte: since, $lte: until } };
    if (options.source) match.source = options.source;

    const grouped = await ConversionEventModel.aggregate<{ _id: ConversionEventName; count: number }>([
      { $match: match },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);
    const counts = new Map(grouped.map((entry) => [entry._id, entry.count]));

    const startCount = counts.get('LANDING_VIEW') ?? 0;
    const steps: FunnelStep[] = CONVERSION_FUNNEL_ORDER.map((event, index) => {
      const count = counts.get(event) ?? 0;
      const previous = index === 0
        ? null
        : counts.get(CONVERSION_FUNNEL_ORDER[index - 1] as ConversionEventName) ?? 0;
      return {
        event,
        count,
        conversionFromPrevious: previous === null ? null : percent(count, previous),
        conversionFromStart: percent(count, startCount),
      };
    });

    const signups = counts.get('SIGNUP_COMPLETED') ?? 0;
    const subscriptions = counts.get('SUBSCRIPTION_STARTED') ?? 0;

    const bySourceRaw = await ConversionEventModel.aggregate<{
      _id: string;
      landing: number;
      signups: number;
      subscriptions: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$source', 'unknown'] },
          landing: { $sum: { $cond: [{ $eq: ['$event', 'LANDING_VIEW'] }, 1, 0] } },
          signups: { $sum: { $cond: [{ $eq: ['$event', 'SIGNUP_COMPLETED'] }, 1, 0] } },
          subscriptions: { $sum: { $cond: [{ $eq: ['$event', 'SUBSCRIPTION_STARTED'] }, 1, 0] } },
        },
      },
      { $sort: { landing: -1 } },
      { $limit: 25 },
    ]);

    return {
      window: { since: since.toISOString(), until: until.toISOString(), days },
      steps,
      totals: {
        visitors: startCount,
        signups,
        demos: counts.get('DEMO_CREATED') ?? 0,
        subscriptions,
      },
      rates: {
        visitToSignupPercent: percent(signups, startCount),
        signupToSubscriptionPercent: percent(subscriptions, signups),
        visitToSubscriptionPercent: percent(subscriptions, startCount),
      },
      bySource: bySourceRaw.map((entry) => ({
        source: entry._id,
        landing: entry.landing,
        signups: entry.signups,
        subscriptions: entry.subscriptions,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}

export const conversionTrackingService = new ConversionTrackingService();

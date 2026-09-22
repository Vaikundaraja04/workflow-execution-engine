import { Types } from 'mongoose';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { CustomerProfileModel } from '../models/CustomerProfileModel.js';
import { UsageMeterModel } from '../models/UsageMeterModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { NotificationLogModel } from '../models/NotificationLogModel.js';
import type { EmailTemplateKey } from '../models/EmailTemplateModel.js';
import { emailNotificationService } from './notifications/emailNotificationService.js';
import { productPackagingService } from './productPackagingService.js';
import { monthPeriodKey } from './usageMeteringService.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 16.5 - Customer lifecycle automation.
 *
 * Runs the lifecycle sends that are time- or threshold-driven (trial started,
 * trial ending, usage warning, upgrade opportunity, inactive customer, renewal
 * reminder) over the existing notification layer. Every send is deduplicated
 * through NotificationLogModel, so a sweep can run as often as the scheduler
 * likes without emailing the same customer twice for the same reason.
 * Welcome stays event-driven at signup.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RULE = 200;
const DEFAULT_PER_RULE = 25;
const TRIAL_ENDING_WINDOW_DAYS = 7;
const USAGE_WARNING_PERCENT = 80;
const UPGRADE_OPPORTUNITY_PERCENT = 60;
const INACTIVE_DAYS = 21;
const MIN_TENANT_AGE_DAYS = 30;

export const LIFECYCLE_RULES = [
  'TRIAL_STARTED',
  'TRIAL_ENDING',
  'USAGE_LIMIT_WARNING',
  'UPGRADE_OPPORTUNITY',
  'INACTIVE_CUSTOMER',
  'SUBSCRIPTION_RENEWAL',
] as const;
export type LifecycleRule = (typeof LIFECYCLE_RULES)[number];

export interface LifecycleSend {
  rule: LifecycleRule;
  template: EmailTemplateKey;
  workspaceId: string;
  recipient: string;
  logId: string;
  status: string;
}

export interface LifecycleSkip {
  rule: LifecycleRule;
  workspaceId: string;
  reason: string;
}

export interface LifecycleRunSummary {
  evaluatedAt: string;
  rules: LifecycleRule[];
  counts: Record<string, number>;
  sent: LifecycleSend[];
  skipped: LifecycleSkip[];
  notes: string[];
}

interface Recipient {
  email: string;
  contactName: string;
  companyName: string;
}

function perRuleLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return DEFAULT_PER_RULE;
  return Math.min(MAX_PER_RULE, Math.floor(limit));
}

function dateOnly(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : 'unknown';
}

export class LifecycleAutomationService {
  /**
   * Run the lifecycle rules and return what was sent and why anything was
   * skipped. Never throws on a single send failure: a provider outage must not
   * stop the rest of the sweep.
   */
  async run(options: {
    now?: Date | undefined;
    limit?: number | undefined;
    rules?: LifecycleRule[] | undefined;
    actorUserId?: string | undefined;
  } = {}): Promise<LifecycleRunSummary> {
    const now = options.now ?? new Date();
    const limit = perRuleLimit(options.limit);
    const rules = options.rules && options.rules.length > 0 ? options.rules : [...LIFECYCLE_RULES];

    const summary: LifecycleRunSummary = {
      evaluatedAt: now.toISOString(),
      rules,
      counts: {},
      sent: [],
      skipped: [],
      notes: ['Welcome email stays event-driven at signup (Phase 15.6)'],
    };

    for (const rule of rules) {
      summary.counts[rule] = 0;
      if (rule === 'TRIAL_STARTED') await this.runTrialStarted(summary, now, limit);
      if (rule === 'TRIAL_ENDING') await this.runTrialEnding(summary, now, limit);
      if (rule === 'USAGE_LIMIT_WARNING') await this.runUsageWarning(summary, now, limit);
      if (rule === 'UPGRADE_OPPORTUNITY') await this.runUpgradeOpportunity(summary, now, limit);
      if (rule === 'INACTIVE_CUSTOMER') await this.runInactiveCustomer(summary, now, limit);
      if (rule === 'SUBSCRIPTION_RENEWAL') await this.runSubscriptionRenewal(summary, now, limit);
    }

    if (options.actorUserId) {
      await createAuditLog({
        action: 'LIFECYCLE_SWEEP_RUN',
        userId: options.actorUserId,
        resource: 'lifecycle_automation',
        resourceId: 'sweep',
        metadata: { counts: summary.counts, sent: summary.sent.length, skipped: summary.skipped.length },
      });
    }

    return summary;
  }

  /** Trial started: subscriptions that entered TRIALING in the last day. */
  private async runTrialStarted(summary: LifecycleRunSummary, now: Date, limit: number): Promise<void> {
    const subscriptions = await SubscriptionModel.find({
      status: 'TRIALING',
      createdAt: { $gte: new Date(now.getTime() - DAY_MS) },
    }).limit(limit).lean();

    for (const subscription of subscriptions) {
      const workspaceId = subscription.workspaceId.toString();
      const daysRemaining = subscription.trialEndsAt
        ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
        : 14;
      await this.send(summary, {
        rule: 'TRIAL_STARTED',
        template: 'TRIAL_STARTED',
        workspaceId,
        key: `trial-start:${subscription._id.toString()}`,
        variables: {
          packageName: await this.packageNameFor(subscription.plan),
          trialEndsAt: dateOnly(subscription.trialEndsAt),
          daysRemaining,
        },
      });
    }
  }

  /** Trial ending: trials that end within the reminder window. */
  private async runTrialEnding(summary: LifecycleRunSummary, now: Date, limit: number): Promise<void> {
    const horizon = new Date(now.getTime() + TRIAL_ENDING_WINDOW_DAYS * DAY_MS);
    const subscriptions = await SubscriptionModel.find({
      status: 'TRIALING',
      trialEndsAt: { $gte: now, $lte: horizon },
    }).limit(limit).lean();

    for (const subscription of subscriptions) {
      const workspaceId = subscription.workspaceId.toString();
      const daysRemaining = subscription.trialEndsAt
        ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
        : 0;
      await this.send(summary, {
        rule: 'TRIAL_ENDING',
        template: 'TRIAL_ENDING',
        workspaceId,
        key: `trial-ending:${dateOnly(subscription.trialEndsAt)}`,
        variables: {
          packageName: await this.packageNameFor(subscription.plan),
          trialEndsAt: dateOnly(subscription.trialEndsAt),
          daysRemaining,
        },
      });
    }
  }

  /** Usage warning: any monthly meter at or above the warning threshold. */
  private async runUsageWarning(summary: LifecycleRunSummary, now: Date, limit: number): Promise<void> {
    const periodKey = monthPeriodKey(now);
    const meters = await UsageMeterModel.find({
      granularity: 'MONTH',
      periodKey,
      percent: { $gte: USAGE_WARNING_PERCENT },
    }).limit(limit).lean();

    for (const meter of meters) {
      const workspaceId = meter.workspaceId.toString();
      const subscription = await SubscriptionModel.findOne({ workspaceId: meter.workspaceId }).select('plan').lean();
      await this.send(summary, {
        rule: 'USAGE_LIMIT_WARNING',
        template: 'USAGE_LIMIT_WARNING',
        workspaceId,
        key: `usage:${periodKey}:${meter.metric}`,
        variables: {
          metric: String(meter.metric).replace(/_/g, ' ').toLowerCase(),
          periodKey,
          percent: meter.percent ?? 0,
          used: meter.value,
          limit: meter.limit ?? 'unlimited',
          packageName: await this.packageNameFor(subscription?.plan ?? null),
        },
      });
    }
  }

  /** Upgrade opportunity: execution usage comfortably high but not yet blocked. */
  private async runUpgradeOpportunity(summary: LifecycleRunSummary, now: Date, limit: number): Promise<void> {
    const periodKey = monthPeriodKey(now);
    const meters = await UsageMeterModel.find({
      granularity: 'MONTH',
      periodKey,
      metric: 'EXECUTIONS',
      percent: { $gte: UPGRADE_OPPORTUNITY_PERCENT, $lt: USAGE_WARNING_PERCENT },
    }).limit(limit).lean();

    for (const meter of meters) {
      const workspaceId = meter.workspaceId.toString();
      const subscription = await SubscriptionModel.findOne({ workspaceId: meter.workspaceId }).select('plan').lean();
      await this.send(summary, {
        rule: 'UPGRADE_OPPORTUNITY',
        template: 'UPGRADE_OPPORTUNITY',
        workspaceId,
        key: `upgrade:${periodKey}`,
        variables: {
          metric: 'Executions',
          periodKey,
          percent: meter.percent ?? 0,
          used: meter.value,
          limit: meter.limit ?? 'unlimited',
          packageName: await this.packageNameFor(subscription?.plan ?? null),
        },
      });
    }
  }

  /** Inactive customer: active tenants with no execution for the idle window. */
  private async runInactiveCustomer(summary: LifecycleRunSummary, now: Date, limit: number): Promise<void> {
    const idleSince = new Date(now.getTime() - INACTIVE_DAYS * DAY_MS);
    const tenants = await TenantAccountModel.find({
      status: 'ACTIVE',
      demo: false,
      createdAt: { $lte: new Date(now.getTime() - MIN_TENANT_AGE_DAYS * DAY_MS) },
    }).limit(limit).lean();

    for (const tenant of tenants) {
      const workspaceId = tenant.workspaceId.toString();
      const [recent, total] = await Promise.all([
        WorkflowExecutionModel.countDocuments({ workspaceId: tenant.workspaceId, createdAt: { $gte: idleSince } }),
        WorkflowExecutionModel.countDocuments({ workspaceId: tenant.workspaceId }),
      ]);
      if (recent > 0 || total === 0) continue;

      const lastExecution = await WorkflowExecutionModel.findOne({ workspaceId: tenant.workspaceId })
        .sort({ createdAt: -1 })
        .select('createdAt')
        .lean();
      const idleDays = lastExecution
        ? Math.floor((now.getTime() - lastExecution.createdAt.getTime()) / DAY_MS)
        : INACTIVE_DAYS;

      await this.send(summary, {
        rule: 'INACTIVE_CUSTOMER',
        template: 'INACTIVE_CUSTOMER',
        workspaceId,
        key: `inactive:${monthPeriodKey(now)}`,
        variables: { idleDays },
      });
    }
  }

  /** Renewal reminder: active subscriptions whose period rolled over recently. */
  private async runSubscriptionRenewal(summary: LifecycleRunSummary, now: Date, limit: number): Promise<void> {
    const subscriptions = await SubscriptionModel.find({
      status: 'ACTIVE',
      currentPeriodStart: { $gte: new Date(now.getTime() - DAY_MS), $lte: now },
    }).limit(limit).lean();

    for (const subscription of subscriptions) {
      if (subscription.createdAt >= subscription.currentPeriodStart) continue;
      await this.send(summary, {
        rule: 'SUBSCRIPTION_RENEWAL',
        template: 'SUBSCRIPTION_RENEWAL',
        workspaceId: subscription.workspaceId.toString(),
        key: `renewal:${subscription.currentPeriodStart.toISOString()}`,
        variables: {
          packageName: await this.packageNameFor(subscription.plan),
          periodEnd: dateOnly(subscription.currentPeriodEnd),
        },
      });
    }
  }

  /** Deduplicated send through the Phase 15.6 notification layer. */
  private async send(
    summary: LifecycleRunSummary,
    input: {
      rule: LifecycleRule;
      template: EmailTemplateKey;
      workspaceId: string;
      key: string;
      variables: Record<string, string | number>;
    },
  ): Promise<void> {
    const alreadySent = await NotificationLogModel.exists({
      workspaceId: new Types.ObjectId(input.workspaceId),
      template: input.template,
      'metadata.dedupeKey': input.key,
      status: 'SENT',
    });
    if (alreadySent) {
      summary.skipped.push({ rule: input.rule, workspaceId: input.workspaceId, reason: `already sent (${input.key})` });
      return;
    }

    const recipient = await this.recipientFor(input.workspaceId);
    if (!recipient) {
      summary.skipped.push({ rule: input.rule, workspaceId: input.workspaceId, reason: 'no billing contact or owner email' });
      return;
    }

    const result = await emailNotificationService.sendSafely({
      to: recipient.email,
      template: input.template,
      workspaceId: input.workspaceId,
      variables: {
        contactName: recipient.contactName,
        companyName: recipient.companyName,
        workspaceName: recipient.companyName,
        ...input.variables,
      },
      metadata: { dedupeKey: input.key, rule: input.rule },
    });
    if (!result) {
      summary.skipped.push({ rule: input.rule, workspaceId: input.workspaceId, reason: 'send failed' });
      return;
    }

    summary.sent.push({
      rule: input.rule,
      template: input.template,
      workspaceId: input.workspaceId,
      recipient: recipient.email,
      logId: result.logId,
      status: result.status,
    });
    if (result.status === 'SENT') {
      summary.counts[input.rule] = (summary.counts[input.rule] ?? 0) + 1;
    }
  }

  /** Billing contact if recorded, otherwise the workspace owner's address. */
  private async recipientFor(workspaceId: string): Promise<Recipient | null> {
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const [profile, tenant] = await Promise.all([
      CustomerProfileModel.findOne({ tenantId: workspaceIdObj })
        .select('contactName contactEmail company')
        .lean(),
      TenantAccountModel.findOne({ workspaceId: workspaceIdObj }).select('companyName').lean(),
    ]);
    const email = profile?.contactEmail
      ?? (await emailNotificationService.resolveWorkspaceRecipient(workspaceId));
    if (!email) return null;
    return {
      email,
      contactName: profile?.contactName ?? 'there',
      companyName: profile?.company ?? tenant?.companyName ?? 'your workspace',
    };
  }

  /** Sellable package name for an internal plan. */
  private async packageNameFor(plan: string | null | undefined): Promise<string> {
    if (!plan) return 'your plan';
    const packageId = productPackagingService.packageForPlan(plan as never);
    if (!packageId) return 'your plan';
    try {
      const productPlan = await productPackagingService.getProductPlan(packageId);
      return productPlan.name;
    } catch {
      return 'your plan';
    }
  }
}

export const lifecycleAutomationService = new LifecycleAutomationService();

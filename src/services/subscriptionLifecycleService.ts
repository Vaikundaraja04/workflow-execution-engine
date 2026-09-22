import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { ISubscription } from '../models/SubscriptionModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { createAuditLog } from './auditService.js';
import { errorFields, logger } from '../observability/logger.js';

export interface SubscriptionSweepResult {
  scanned: number;
  markedPastDue: number;
  expired: number;
}

const DEFAULT_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function readGraceDays(): number {
  const raw = Number(process.env.SUBSCRIPTION_GRACE_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_GRACE_DAYS;
}

export class SubscriptionLifecycleService {
  private timer: NodeJS.Timeout | null = null;
  private timerIntervalMs: number | null = null;
  async sweep(options: { now?: Date } = {}): Promise<SubscriptionSweepResult> {
    const now = options.now ?? new Date();
    const nowMs = now.getTime();
    const graceMs = readGraceDays() * DAY_MS;
    const candidates = await SubscriptionModel.find({
      status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED'] },
    });
    const result: SubscriptionSweepResult = {
      scanned: candidates.length,
      markedPastDue: 0,
      expired: 0,
    };

    for (const subscription of candidates) {
      const periodEnd = subscription.currentPeriodEnd ? subscription.currentPeriodEnd.getTime() : 0;

      if (subscription.status === 'CANCELLED') {
        if (periodEnd > 0 && periodEnd < nowMs) {
          await this.expire(subscription, now);
          result.expired += 1;
        }
        continue;
      }

      const trialEnd = subscription.status === 'TRIALING' && subscription.trialEndsAt
        ? subscription.trialEndsAt.getTime()
        : null;
      const overdueSince = trialEnd !== null && trialEnd < nowMs ? trialEnd : periodEnd;
      if (overdueSince <= 0 || overdueSince >= nowMs) continue;

      if (overdueSince + graceMs < nowMs) {
        await this.expire(subscription, now);
        result.expired += 1;
        continue;
      }

      if (subscription.status === 'PAST_DUE') continue;

      subscription.status = 'PAST_DUE';
      await subscription.save();
      await createAuditLog({
          action: 'PAYMENT_FAILED',
          workspaceId: subscription.workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          metadata: {
            reason: 'period_ended',
            overdueSince: new Date(overdueSince).toISOString(),
            graceDays: readGraceDays(),
          },
        });
      result.markedPastDue += 1;
    }
  return result;
  }

  private async expire(subscription: ISubscription, now: Date): Promise<void> {
    const previousPlan = subscription.plan;
    subscription.status = 'EXPIRED';
    subscription.plan = 'FREE';
    await subscription.save();

    await TenantAccountModel.updateOne(
      { workspaceId: subscription.workspaceId },
      { $set: { plan: 'FREE' } },
    );

    await createAuditLog({
      action: 'SUBSCRIPTION_EXPIRED',
      workspaceId: subscription.workspaceId,
      resource: 'subscription',
      resourceId: subscription._id.toString(),
      metadata: {
        previousPlan,
        downgradedTo: 'FREE',
        expiredAt: now.toISOString(),
      },
    });
  }

  startScheduler(): { started: boolean; intervalMs: number | null } {
    if (this.timer) return { started: false, intervalMs: this.timerIntervalMs };
    const raw = Number(process.env.SUBSCRIPTION_SWEEP_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < 60_000) return { started: false, intervalMs: null };
    const intervalMs = Math.floor(raw);
    this.timer = setInterval(() => {
      void this.sweep().catch((error) => {
        logger.warn('subscription_sweep_failed', errorFields(error));
      });
    }, intervalMs);
    this.timer.unref();
    this.timerIntervalMs = intervalMs;
    logger.info('subscription_sweep_scheduler_started', { intervalMs });
    return { started: true, intervalMs };
  }

  stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.timerIntervalMs = null;
  }
}

export const subscriptionLifecycleService = new SubscriptionLifecycleService();

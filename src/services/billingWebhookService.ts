import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionPlan, SubscriptionStatus } from '../models/SubscriptionModel.js';
import { WebhookEventModel } from '../models/WebhookEventModel.js';
import type { WebhookEventStatus, WebhookEventType } from '../models/WebhookEventModel.js';
import { createBillingProvider } from './billing/billingProviderRegistry.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 15.4 - Billing webhook processing.
 *
 * Signature verification stays with the provider (Stripe t/v1 HMAC-SHA256,
 * Razorpay X-Razorpay-Signature HMAC-SHA256, mock passthrough). This service adds
 * the platform concerns: idempotency (one row per provider + event id),
 * normalization onto the platform vocabulary, application to the subscription,
 * and an audit entry per applied event. Raw payloads, signatures and payment
 * credentials are never persisted or audited.
 */

export interface WebhookProcessResult {
  status: WebhookEventStatus;
  type: WebhookEventType;
  provider: string;
  eventId: string;
  duplicate: boolean;
  applied: boolean;
  message: string;
}

/** Provider event name -> platform vocabulary. */
export function normalizeWebhookEvent(providerType: string): WebhookEventType {
  const type = providerType.trim();
  switch (type) {
    case 'payment.succeeded':
    case 'payment.captured':
    case 'payment_intent.succeeded':
    case 'payment_success':
      return 'payment_success';
    case 'payment.failed':
    case 'payment_intent.payment_failed':
    case 'payment_failed':
      return 'payment_failed';
    case 'customer.subscription.created':
    case 'subscription.authenticated':
    case 'subscription.activated':
    case 'subscription.created':
      return 'subscription_created';
    case 'customer.subscription.updated':
    case 'subscription.updated':
    case 'subscription.charged':
    case 'subscription.paused':
    case 'subscription.resumed':
      return 'subscription_updated';
    case 'customer.subscription.deleted':
    case 'subscription.cancelled':
    case 'subscription.halted':
    case 'subscription.completed':
      return 'subscription_cancelled';
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice_paid':
      return 'invoice_paid';
    default:
      return 'unhandled';
  }
}

function mapBillingStatusToInternal(status: string): SubscriptionStatus | null {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
    case 'cancelled':
      return 'CANCELLED';
    case 'unpaid':
      return 'PAST_DUE';
    default:
      return null;
  }
}

function unixSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const PLAN_IDS = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;

function includesPlan(value: string): boolean {
  return (PLAN_IDS as readonly string[]).includes(value);
}

function metadataOf(data: Record<string, unknown>): Record<string, unknown> {
  const metadata = data.metadata;
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
}

export interface ApplyOutcome {
  applied: boolean;
  message: string;
  workspaceId?: string | null;
  externalSubscriptionId?: string | null;
  externalCustomerId?: string | null;
}

export class BillingWebhookService {
  /**
   * Verify, de-duplicate and apply a provider webhook.
   * Throws INVALID_WEBHOOK_SIGNATURE / INVALID_WEBHOOK_PAYLOAD before any write.
   */
  async process(input: {
    provider?: string | undefined;
    rawBody: string;
    signature: string;
  }): Promise<WebhookProcessResult> {
    const provider = createBillingProvider(input.provider);
    const providerName = input.provider ?? 'mock';

    const event = await provider.handleWebhook(input.rawBody, input.signature);
    const providerType = typeof event.type === 'string' ? event.type : '';
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (!providerType || !data || typeof data !== 'object') {
      throw new Error('INVALID_WEBHOOK_PAYLOAD');
    }

    const eventId = this.eventIdFor(providerType, data);
    const type = normalizeWebhookEvent(providerType);

    const existing = await WebhookEventModel.findOne({ provider: providerName, eventId }).lean();
    if (existing && existing.status !== 'FAILED') {
      return {
        status: existing.status,
        type: existing.type,
        provider: providerName,
        eventId,
        duplicate: true,
        applied: existing.status === 'APPLIED',
        message: 'Duplicate delivery ignored',
      };
    }

    let outcome: ApplyOutcome;
    try {
      outcome = await this.apply(providerName, type, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WEBHOOK_APPLY_FAILED';
      await WebhookEventModel.findOneAndUpdate(
        { provider: providerName, eventId },
        {
          $set: {
            provider: providerName,
            eventId,
            providerType,
            type,
            status: 'FAILED',
            error: message.slice(0, 500),
          },
          $inc: { attempts: 1 },
        },
        { upsert: true },
      );
      throw error;
    }

    const status: WebhookEventStatus = outcome.applied ? 'APPLIED' : 'IGNORED';
    const appliedAt = outcome.applied ? new Date() : null;
    await WebhookEventModel.findOneAndUpdate(
      { provider: providerName, eventId },
      {
        $set: {
          provider: providerName,
          eventId,
          providerType,
          type,
          status,
          workspaceId: outcome.workspaceId ? new Types.ObjectId(outcome.workspaceId) : null,
          externalSubscriptionId: outcome.externalSubscriptionId ?? null,
          externalCustomerId: outcome.externalCustomerId ?? null,
          appliedAt,
          error: null,
        },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );

    await createAuditLog({
      action: 'BILLING_WEBHOOK_RECEIVED',
      ...(outcome.workspaceId ? { workspaceId: new Types.ObjectId(outcome.workspaceId) } : {}),
      resource: 'billing_webhook',
      resourceId: `${providerName}:${eventId}`,
      metadata: {
        provider: providerName,
        providerType,
        type,
        status,
        duplicate: false,
      },
    });

    return {
      status,
      type,
      provider: providerName,
      eventId,
      duplicate: false,
      applied: outcome.applied,
      message: outcome.message,
    };
  }

  /** Stable event id: provider event ids when present, otherwise a payload hash. */
  private eventIdFor(providerType: string, data: Record<string, unknown>): string {
    const explicit = data.eventId ?? data.event_id;
    if (typeof explicit === 'string' && explicit.length > 0) return explicit;
    const hash = createHash('sha256').update(`${providerType}:${JSON.stringify(data)}`).digest('hex').slice(0, 32);
    return `${providerType}:${hash}`;
  }

  /** Apply a normalized event to the subscription state. */
  private async apply(
    providerName: string,
    type: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<ApplyOutcome> {
    if (type === 'unhandled') {
      return { applied: false, message: 'Event type is not applied by the platform' };
    }

    const metadata = metadataOf(data);
    const workspaceIdFromMetadata = typeof metadata.workspaceId === 'string' ? metadata.workspaceId : null;
    const externalSubscriptionId = typeof data.id === 'string' ? data.id : null;
    const customer = data.customer;
    const externalCustomerId = typeof customer === 'string'
      ? customer
      : customer && typeof customer === 'object' && typeof (customer as { id?: unknown }).id === 'string'
        ? ((customer as { id: string }).id)
        : null;

    let subscription = externalSubscriptionId
      ? await SubscriptionModel.findOne({ externalSubscriptionId })
      : externalCustomerId
        ? await SubscriptionModel.findOne({ externalCustomerId })
        : null;

    if (type === 'subscription_created' && !subscription) {
      if (!workspaceIdFromMetadata || !externalSubscriptionId || !externalCustomerId) {
        return {
          applied: false,
          message: 'Subscription event cannot be matched to a workspace',
          workspaceId: workspaceIdFromMetadata,
          externalSubscriptionId,
          externalCustomerId,
        };
      }
      const status = mapBillingStatusToInternal(String(data.status ?? '')) ?? 'ACTIVE';
      const plan = typeof metadata.plan === 'string' && includesPlan(metadata.plan)
        ? (metadata.plan as SubscriptionPlan)
        : 'FREE';
      const periodStart = unixSeconds(data.current_period_start) ?? Math.floor(Date.now() / 1000);
      const periodEnd = unixSeconds(data.current_period_end) ?? periodStart + 30 * 24 * 60 * 60;
      const trialEnd = unixSeconds(data.trial_end);
      subscription = await SubscriptionModel.create({
        workspaceId: new Types.ObjectId(workspaceIdFromMetadata),
        plan,
        status,
        billingProvider: providerName,
        externalCustomerId,
        externalSubscriptionId,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        trialEndsAt: trialEnd ? new Date(trialEnd * 1000) : null,
      });
      await createAuditLog({
        action: 'SUBSCRIPTION_CREATED',
        workspaceId: subscription.workspaceId,
        resource: 'subscription',
        resourceId: subscription._id.toString(),
        metadata: { externalSubscriptionId, externalCustomerId, status: subscription.status, plan: subscription.plan },
      });
      return {
        applied: true,
        message: 'Subscription created',
        workspaceId: subscription.workspaceId.toString(),
        externalSubscriptionId,
        externalCustomerId,
      };
    }

    if (!subscription) {
      return {
        applied: false,
        message: 'No workspace subscription matches this event',
        workspaceId: workspaceIdFromMetadata,
        externalSubscriptionId,
        externalCustomerId,
      };
    }

    if (type === 'payment_failed') {
      if (subscription.status !== 'PAST_DUE') {
        subscription.status = 'PAST_DUE';
        await subscription.save();
      }
      await createAuditLog({
        action: 'PAYMENT_FAILED',
        workspaceId: subscription.workspaceId,
        resource: 'subscription',
        resourceId: subscription._id.toString(),
        metadata: { provider: providerName, externalSubscriptionId },
      });
      return {
        applied: true,
        message: 'Subscription marked past due',
        workspaceId: subscription.workspaceId.toString(),
        externalSubscriptionId,
        externalCustomerId,
      };
    }

    if (type === 'payment_success' || type === 'invoice_paid') {
      if (subscription.status === 'PAST_DUE') {
        subscription.status = 'ACTIVE';
        await subscription.save();
      }
      return {
        applied: true,
        message: type === 'invoice_paid' ? 'Invoice payment recorded' : 'Payment recorded',
        workspaceId: subscription.workspaceId.toString(),
        externalSubscriptionId,
        externalCustomerId,
      };
    }

    if (type === 'subscription_cancelled') {
      subscription.status = 'CANCELLED';
      await subscription.save();
      await createAuditLog({
        action: 'SUBSCRIPTION_CANCELLED',
        workspaceId: subscription.workspaceId,
        resource: 'subscription',
        resourceId: subscription._id.toString(),
        metadata: { provider: providerName, externalSubscriptionId },
      });
      return {
        applied: true,
        message: 'Subscription cancelled',
        workspaceId: subscription.workspaceId.toString(),
        externalSubscriptionId,
        externalCustomerId,
      };
    }

    // subscription_created (matched) / subscription_updated
    const mappedStatus = mapBillingStatusToInternal(String(data.status ?? ''));
    if (mappedStatus) subscription.status = mappedStatus;
    const periodStart = unixSeconds(data.current_period_start);
    const periodEnd = unixSeconds(data.current_period_end);
    if (periodStart) subscription.currentPeriodStart = new Date(periodStart * 1000);
    if (periodEnd) subscription.currentPeriodEnd = new Date(periodEnd * 1000);
    const trialEnd = unixSeconds(data.trial_end);
    if (trialEnd) subscription.trialEndsAt = new Date(trialEnd * 1000);
    const plan = typeof metadata.plan === 'string' && includesPlan(metadata.plan)
      ? (metadata.plan as SubscriptionPlan)
      : null;
    if (plan) subscription.plan = plan;
    await subscription.save();

    if (type === 'subscription_created') {
      await createAuditLog({
        action: 'SUBSCRIPTION_CREATED',
        workspaceId: subscription.workspaceId,
        resource: 'subscription',
        resourceId: subscription._id.toString(),
        metadata: { externalSubscriptionId, externalCustomerId, status: subscription.status, plan: subscription.plan },
      });
    } else {
      await createAuditLog({
        action: 'SUBSCRIPTION_CHANGED',
        workspaceId: subscription.workspaceId,
        resource: 'subscription',
        resourceId: subscription._id.toString(),
        metadata: { externalSubscriptionId, status: subscription.status, plan: subscription.plan },
      });
    }

    return {
      applied: true,
      message: type === 'subscription_created' ? 'Subscription created' : 'Subscription updated',
      workspaceId: subscription.workspaceId.toString(),
      externalSubscriptionId,
      externalCustomerId,
    };
  }
}

export const billingWebhookService = new BillingWebhookService();

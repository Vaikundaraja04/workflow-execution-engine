import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createAuditLog } from '../../services/auditService.js';
import { SubscriptionModel } from '../../models/SubscriptionModel.js';
import { Types } from 'mongoose';
import { PlanModel } from '../../models/PlanModel.js';
import type { SubscriptionStatus } from '../../models/SubscriptionModel.js';
import type { SubscriptionPlan } from '../../models/SubscriptionModel.js';

/**
 * Billing webhook endpoint
 * This endpoint receives webhooks from billing providers (Stripe, Razorpay, etc.)
 */

const billingWebhookRouter = Router();

// Placeholder for signature verification
function verifyWebhookSignature(_req: Request): boolean {
  return true;
}

billingWebhookRouter.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(400).json({
        error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' },
      });
    }

    const { type, data } = req.body;

    if (!type || typeof type !== 'string' || !data) {
      return res.status(400).json({
        error: { code: 'INVALID_WEBHOOK_PAYLOAD', message: 'Invalid webhook payload' },
      });
    }

    switch (type) {
      case 'subscription.created':
        await handleSubscriptionCreated(data);
        break;
      case 'subscription.updated':
        await handleSubscriptionUpdated(data);
        break;
      case 'subscription.cancelled':
        await handleSubscriptionCancelled(data);
        break;
      case 'payment.failed':
        await handlePaymentFailed(data);
        break;
      default:
        console.log(`Unhandled billing webhook event: ${type}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

async function handleSubscriptionCreated(data: any) {
  const {
    id: externalSubscriptionId,
    customer,
    status,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    trial_end: trialEndsAt,
    metadata = {},
  } = data;

  const externalCustomerId = customer?.id || customer;

  let subscription = await SubscriptionModel.findOne({ externalCustomerId });
  if (!subscription) {
    const workspaceId = metadata.workspaceId || metadata.workspace_id;
    if (workspaceId) {
      subscription = await SubscriptionModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        plan: (metadata.plan as SubscriptionPlan) || 'FREE',
        status: mapBillingStatusToInternal(status) ?? 'ACTIVE',
        billingProvider: 'mock',
        externalCustomerId,
        externalSubscriptionId,
        currentPeriodStart: new Date((currentPeriodStart || Date.now() / 1000) * 1000),
        currentPeriodEnd: new Date((currentPeriodEnd || (Date.now() / 1000 + 30 * 86400)) * 1000),
        ...(trialEndsAt ? { trialEndsAt: new Date(trialEndsAt * 1000) } : {}),
      });
    } else {
      console.warn(`No subscription found for externalCustomerId: ${externalCustomerId}`);
      return;
    }
  } else {
    subscription.externalSubscriptionId = externalSubscriptionId;
    subscription.status = mapBillingStatusToInternal(status) ?? subscription.status;
    if (currentPeriodStart) subscription.currentPeriodStart = new Date(currentPeriodStart * 1000);
    if (currentPeriodEnd) subscription.currentPeriodEnd = new Date(currentPeriodEnd * 1000);
    if (trialEndsAt !== undefined) {
      subscription.trialEndsAt = trialEndsAt ? new Date(trialEndsAt * 1000) : null;
    }
    await subscription.save();
  }

  await createAuditLog({
    action: 'SUBSCRIPTION_CREATED',
    workspaceId: subscription.workspaceId,
    resource: 'subscription',
    resourceId: subscription._id.toString(),
    metadata: {
      externalSubscriptionId,
      externalCustomerId,
      status: subscription.status,
      plan: subscription.plan,
    },
  });
}

async function handleSubscriptionUpdated(data: any) {
  const {
    id: externalSubscriptionId,
    status,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    trial_end: trialEndsAt,
    metadata = {},
  } = data;

  const subscription = await SubscriptionModel.findOne({ externalSubscriptionId });
  if (!subscription) {
    console.warn(`Subscription not found for externalSubscriptionId: ${externalSubscriptionId}`);
    return;
  }

  subscription.status = mapBillingStatusToInternal(status) ?? subscription.status;
  if (currentPeriodStart) subscription.currentPeriodStart = new Date(currentPeriodStart * 1000);
  if (currentPeriodEnd) subscription.currentPeriodEnd = new Date(currentPeriodEnd * 1000);
  if (trialEndsAt !== undefined && trialEndsAt !== null) {
    subscription.trialEndsAt = new Date(trialEndsAt * 1000);
  } else if (trialEndsAt === null) {
    subscription.trialEndsAt = null;
  }

  await subscription.save();

  await createAuditLog({
    action: 'SUBSCRIPTION_CHANGED',
    workspaceId: subscription.workspaceId,
    resource: 'subscription',
    resourceId: subscription._id.toString(),
    metadata: {
      externalSubscriptionId,
      status: subscription.status,
      plan: subscription.plan,
    },
  });
}

async function handleSubscriptionCancelled(data: any) {
  const {
    id: externalSubscriptionId,
  } = data;

  const subscription = await SubscriptionModel.findOne({ externalSubscriptionId });
  if (!subscription) {
    console.warn(`Subscription not found for externalSubscriptionId: ${externalSubscriptionId}`);
    return;
  }

  subscription.status = 'CANCELLED';
  await subscription.save();

  await createAuditLog({
    action: 'SUBSCRIPTION_CANCELLED',
    workspaceId: subscription.workspaceId,
    resource: 'subscription',
    resourceId: subscription._id.toString(),
    metadata: {
      externalSubscriptionId,
    },
  });
}

async function handlePaymentFailed(data: any) {
  const {
    id: externalSubscriptionId,
  } = data;

  const subscription = await SubscriptionModel.findOne({ externalSubscriptionId });
  if (!subscription) {
    console.warn(`Subscription not found for externalSubscriptionId: ${externalSubscriptionId}`);
    return;
  }

  if (subscription.status !== 'PAST_DUE') {
    subscription.status = 'PAST_DUE';
    await subscription.save();
  }

  await createAuditLog({
    action: 'PAYMENT_FAILED',
    workspaceId: subscription.workspaceId,
    resource: 'subscription',
    resourceId: subscription._id.toString(),
    metadata: {
      externalSubscriptionId,
    },
  });
}

// Helper to map billing provider subscription status to our internal status
function mapBillingStatusToInternal(billingStatus: string): SubscriptionStatus | null {
  switch (billingStatus) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELLED';
    case 'unpaid':
      return 'PAST_DUE';
    default:
      return null;
  }
}

export function createBillingRouter() {
  return billingWebhookRouter;
}

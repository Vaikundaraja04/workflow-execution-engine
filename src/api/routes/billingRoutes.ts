import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createAuditLog } from '../../services/auditService.js';
import { SubscriptionModel } from '../../models/SubscriptionModel.js';
import { Types } from 'mongoose';
import { PlanModel } from '../../models/PlanModel.js';
import type { SubscriptionStatus } from '../../models/SubscriptionModel.js';
import type { SubscriptionPlan } from '../../models/SubscriptionModel.js';
import { billingService } from '../../services/billingService.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { z } from 'zod';

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
  const router = Router();

  // Subscribe workspace to a plan
  router.post(
    '/subscribe',
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        // Validate request body
        const subscribeSchema = z.object({
          plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
          billingProvider: z.string().optional().default('mock'),
        });

        const parsed = subscribeSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const { plan, billingProvider } = parsed.data;

        // Subscribe the workspace
        const subscription = await billingService.subscribeWorkspace(workspaceId, plan, billingProvider);

        // Create audit log
        await createAuditLog({
          action: 'SUBSCRIPTION_CREATED',
          userId,
          workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          metadata: {
            plan: subscription.plan,
            status: subscription.status,
            billingProvider: subscription.billingProvider
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        res.json({
          message: 'Workspace subscribed successfully',
          subscription: {
            id: subscription._id.toString(),
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEndsAt: subscription.trialEndsAt
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get current subscription
  router.get(
    '/subscription',
    requirePermission('WORKFLOW_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const subscription = await billingService.getSubscription(workspaceId);

        if (!subscription) {
          return res.status(404).json({
            error: { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' },
          });
        }

        let plan = await PlanModel.findOne({ id: subscription.plan });
        if (!plan) {
          // Ensure default plans exist
          await PlanModel.insertMany(Object.values(require('../../models/PlanModel.js').DEFAULT_PLANS));
          plan = await PlanModel.findOne({ id: subscription.plan });
        }

        res.json({
          plan: subscription.plan,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          trialEndsAt: subscription.trialEndsAt,
          planDetails: plan ? {
            id: plan.id,
            name: plan.name,
            description: plan.description,
            priceMonthly: plan.priceMonthly,
            currency: plan.currency,
            limits: plan.limits,
            features: plan.features,
          } : null
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Upgrade subscription
  router.post(
    '/upgrade',
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        // Validate request body
        const upgradeSchema = z.object({
          plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
        });

        const parsed = upgradeSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const { plan: newPlan } = parsed.data;

        // Upgrade the subscription
        const subscription = await billingService.upgradeSubscription(workspaceId, newPlan);
        if (!subscription) {
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } });
        }

        // Create audit log
        await createAuditLog({
          action: 'SUBSCRIPTION_UPGRADED',
          userId,
          workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          metadata: {
            newPlan: subscription.plan
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        res.json({
          message: 'Subscription upgraded successfully',
          subscription: {
            id: subscription._id.toString(),
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Downgrade subscription
  router.post(
    '/downgrade',
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        // Validate request body
        const downgradeSchema = z.object({
          plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
        });

        const parsed = downgradeSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const { plan: newPlan } = parsed.data;

        // Downgrade the subscription
        const subscription = await billingService.downgradeSubscription(workspaceId, newPlan);
        if (!subscription) {
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } });
        }

        // Create audit log
        await createAuditLog({
          action: 'SUBSCRIPTION_DOWNGRADED',
          userId,
          workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          metadata: {
            newPlan: subscription.plan
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        res.json({
          message: 'Subscription downgraded successfully',
          subscription: {
            id: subscription._id.toString(),
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cancel subscription
  router.post(
    '/cancel',
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        // Validate request body
        const cancelSchema = z.object({
          immediate: z.boolean().optional().default(false),
        });

        const parsed = cancelSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const { immediate } = parsed.data;

        // Cancel the subscription
        const subscription = await billingService.cancelSubscription(workspaceId, immediate);

        // Create audit log
        await createAuditLog({
          action: 'SUBSCRIPTION_CANCELLED',
          userId,
          workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          metadata: {
            immediate
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        res.json({
          message: 'Subscription cancelled successfully',
          subscription: {
            id: subscription._id.toString(),
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get current usage
  router.get(
    '/usage',
    requirePermission('WORKFLOW_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const usage = await billingService.getUsage(workspaceId);

        if (!usage) {
          return res.status(404).json({
            error: { code: 'USAGE_NOT_FOUND', message: 'Usage data not found' },
          });
        }

        res.json({
          usage
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Check feature entitlement
  router.post(
    '/check-feature',
    requirePermission('WORKFLOW_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;

        // Validate request body
        const featureSchema = z.object({
          feature: z.string(),
        });

        const parsed = featureSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const { feature } = parsed.data;

        const entitled = await billingService.checkFeatureEntitlement(workspaceId, feature);

        res.json({
          feature,
          entitled
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.use(billingWebhookRouter);

  return router;
}


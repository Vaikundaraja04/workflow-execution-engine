import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createAuditLog } from '../../services/auditService.js';
import { PlanModel, ensureDefaultPlans } from '../../models/PlanModel.js';
import type { SubscriptionStatus } from '../../models/SubscriptionModel.js';
import type { SubscriptionPlan } from '../../models/SubscriptionModel.js';
import { billingService } from '../../services/billingService.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { requireActiveTenant } from '../middleware/requireEntitlement.js';
import { createBillingProvider } from '../../services/billing/billingProviderRegistry.js';
import { billingWebhookService } from '../../services/billingWebhookService.js';
import { z } from 'zod';

/**
 * Billing webhook endpoint
 * This endpoint receives webhooks from billing providers (Stripe, Razorpay, etc.)
 */

const billingWebhookRouter = Router();

function rawRequestBody(req: Request): string {
  const raw = (req as Request & { rawBody?: string }).rawBody;
  return typeof raw === 'string' && raw.length > 0 ? raw : JSON.stringify(req.body ?? {});
}

function webhookSignature(req: Request): string {
  const stripeSignature = req.get('stripe-signature');
  if (stripeSignature) return stripeSignature;
  return req.get('x-razorpay-signature') ?? '';
}

billingWebhookRouter.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await billingWebhookService.process({
      provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
      rawBody: rawRequestBody(req),
      signature: webhookSignature(req),
    });
    res.status(200).json({ received: true, ...result });
  } catch (error) {
    if (
      error instanceof Error
      && (error.message === 'INVALID_WEBHOOK_SIGNATURE' || error.message === 'INVALID_WEBHOOK_PAYLOAD')
    ) {
      return res.status(400).json({
        error: { code: error.message, message: 'Webhook verification failed' },
      });
    }
    next(error);
  }
});

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
          billingProvider: z.string().optional(),
          trialDays: z.number().int().min(1).max(90).optional(),
        });

        const parsed = subscribeSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const { plan, billingProvider, trialDays } = parsed.data;

        // Subscribe the workspace
        const subscription = await billingService.subscribeWorkspace(
          workspaceId,
          plan,
          billingProvider,
          trialDays ? { trialDays } : {},
        );

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

  // Start a trial on the workspace subscription
  router.post(
    '/trial',
    requireActiveTenant(),
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const trialSchema = z.object({
          days: z.number().int().min(1).max(90).optional(),
        });
        const parsed = trialSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const subscription = await billingService.startTrial(workspaceId, parsed.data.days);
        res.json({
          message: 'Trial started successfully',
          subscription: {
            id: subscription._id.toString(),
            plan: subscription.plan,
            status: subscription.status,
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodEnd: subscription.currentPeriodEnd,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // List provider invoices for the workspace subscription
  router.get(
    '/invoices',
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
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 12;
        const provider = createBillingProvider(subscription.billingProvider);
        const invoices = await provider.listInvoices({
          customerId: subscription.externalCustomerId,
          limit: Number.isFinite(limit) ? limit : 12,
        });
        res.json({ invoices });
      } catch (err) {
        next(err);
      }
    },
  );

  router.use(billingWebhookRouter);

  return router;
}



export function createBillingCatalogRouter(): Router {
  const router = Router();

  router.get(
    '/plans',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        let plans = await PlanModel.find({ isActive: true }).sort({ priceMonthly: 1 });
        if (plans.length === 0) {
          await ensureDefaultPlans();
          plans = await PlanModel.find({ isActive: true }).sort({ priceMonthly: 1 });
        }
        res.json({
          plans: plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            description: plan.description,
            priceMonthly: plan.priceMonthly,
            currency: plan.currency,
            limits: plan.limits,
            features: plan.features,
          })),
          aliases: { BUSINESS: 'PROFESSIONAL' },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export function createBillingWebhookRouter(): Router {
  return billingWebhookRouter;
}
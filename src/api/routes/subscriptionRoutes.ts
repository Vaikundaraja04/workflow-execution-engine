import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { SubscriptionModel } from '../../models/SubscriptionModel.js';
import { WorkspaceModel } from '../../models/WorkspaceModel.js';
import { PlanModel, ensureDefaultPlans } from '../../models/PlanModel.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { createAuditLog } from '../../services/auditService.js';
import { getPlan, comparePlanLimits, validateWorkspaceQuota } from '../../services/planService.js';
import { MockBillingProvider } from '../../services/billing/mockBillingProvider.js';

// Initialize mock billing provider (in production, this would be dependency injected)
const billingProvider = new MockBillingProvider();

const upgradeSubscriptionSchema = z.object({
  plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  workspaceId: z.string().optional(),
}).strict();

const changePlanSchema = z.object({
  newPlan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  workspaceId: z.string().optional(),
}).strict();

/**
 * Create subscription router.
 * This router handles subscription-related endpoints.
 */
export function createSubscriptionRouter(): Router {
  const router = Router();

  // Get current subscription info
  router.get(
    '/',
    requireMembership(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const subscription = await SubscriptionModel.findOne({ workspaceId });

        if (!subscription) {
          return res.status(404).json({
            error: { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' },
          });
        }

        let plan = await PlanModel.findOne({ id: subscription.plan });
        if (!plan) {
          await ensureDefaultPlans();
          plan = await PlanModel.findOne({ id: subscription.plan });
        }

        // Get current usage
        const usage = await getPlan(workspaceId);

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
          } : null,
          usage: usage ?? null,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Upgrade subscription (change to a different plan)
  router.post(
    '/upgrade',
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = upgradeSubscriptionSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;
        const { plan: newPlan } = parsed.data;

        const subscription = await SubscriptionModel.findOne({ workspaceId });
        if (!subscription) {
          return res.status(404).json({
            error: { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' },
          });
        }

        const currentPlan = subscription.plan;

        let planDoc = await PlanModel.findOne({ id: newPlan });
        if (!planDoc) {
          await ensureDefaultPlans();
          planDoc = await PlanModel.findOne({ id: newPlan });
        }

        if (!planDoc) {
          return res.status(400).json({
            error: { code: 'INVALID_PLAN', message: 'Invalid plan specified' },
          });
        }

        // Update subscription
        subscription.plan = newPlan;
        subscription.status = 'ACTIVE';
        await subscription.save();

        // Create audit log
        await createAuditLog({
          action: 'SUBSCRIPTION_CHANGED',
          userId,
          workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          metadata: {
            previousPlan: currentPlan,
            newPlan: newPlan,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        res.json({
          message: 'Subscription updated successfully',
          subscription: {
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
          },
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

        const subscription = await SubscriptionModel.findOne({ workspaceId });
        if (!subscription) {
          return res.status(404).json({
            error: { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' },
          });
        }

        if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
          return res.status(400).json({
            error: { code: 'SUBSCRIPTION_ALREADY_CANCELLED', message: 'Subscription is already cancelled or expired' },
          });
        }

        subscription.status = 'CANCELLED';
        await subscription.save();

        // Create audit log
        await createAuditLog({
          action: 'SUBSCRIPTION_CANCELLED',
          userId,
          workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        res.json({
          message: 'Subscription cancelled successfully',
          subscription: {
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Change plan (alias for upgrade, but could handle more complex changes)
  router.post(
    '/change-plan',
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = changePlanSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;
        const { newPlan } = parsed.data;

        const subscription = await SubscriptionModel.findOne({ workspaceId });
        if (!subscription) {
          return res.status(404).json({
            error: { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' },
          });
        }

        let planDoc = await PlanModel.findOne({ id: newPlan });
        if (!planDoc) {
          await ensureDefaultPlans();
          planDoc = await PlanModel.findOne({ id: newPlan });
        }

        if (!planDoc) {
          return res.status(400).json({
            error: { code: 'INVALID_PLAN', message: 'Invalid plan specified' },
          });
        }

        const previousPlan = subscription.plan;
        subscription.plan = newPlan;
        subscription.status = 'ACTIVE';
        await subscription.save();

        // Create audit log
        await createAuditLog({
          action: 'SUBSCRIPTION_CHANGED',
          userId,
          workspaceId,
          resource: 'subscription',
          resourceId: subscription._id.toString(),
          metadata: {
            previousPlan,
            newPlan,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        res.json({
          message: 'Plan changed successfully',
          subscription: {
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get all available plans
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
          plans: plans.map((plan: any) => ({
            id: plan.id,
            name: plan.name,
            description: plan.description,
            priceMonthly: plan.priceMonthly,
            currency: plan.currency,
            limits: plan.limits,
            features: plan.features,
          })),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

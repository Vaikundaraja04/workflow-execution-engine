import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { growthAnalyticsService } from '../../services/growthAnalyticsService.js';
import { lifecycleAutomationService, LIFECYCLE_RULES } from '../../services/lifecycleAutomationService.js';
import { emailNotificationService } from '../../services/notifications/emailNotificationService.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';

/**
 * Phase 16.1 - Growth analytics API.
 *
 * Platform-administrator reads over the growth ledger: the acquisition funnel,
 * per-source conversion with CAC/activation and cohort retention. Every number
 * comes from recorded events and real execution activity.
 */

const windowQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30).optional(),
  source: z.string().trim().max(64).optional(),
});

const conversionQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30).optional(),
  spend: z.coerce.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
});

const retentionQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(6).optional(),
});

const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });

export function createGrowthRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const admin = [requireAuth, requirePlatformAdmin()] as RequestHandler[];

  router.get('/funnel', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = windowQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json(badRequest('Invalid query parameters'));
      res.json(await growthAnalyticsService.funnel({
        ...(parsed.data.days !== undefined ? { days: parsed.data.days } : {}),
        ...(parsed.data.source !== undefined ? { source: parsed.data.source } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/conversion', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = conversionQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json(badRequest('Invalid query parameters'));
      res.json(await growthAnalyticsService.conversion({
        ...(parsed.data.days !== undefined ? { days: parsed.data.days } : {}),
        ...(parsed.data.spend !== undefined ? { spend: parsed.data.spend } : {}),
        ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/retention', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = retentionQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json(badRequest('Invalid query parameters'));
      res.json(await growthAnalyticsService.retention({
        ...(parsed.data.months !== undefined ? { months: parsed.data.months } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  // Phase 16.5 - lifecycle automation: run the sweep and inspect the log.
  const lifecycleRunSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    rules: z.array(z.enum(LIFECYCLE_RULES)).min(1).optional(),
  }).strict();

  router.post('/lifecycle/run', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = lifecycleRunSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      res.json(await lifecycleAutomationService.run({
        ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
        ...(parsed.data.rules !== undefined ? { rules: parsed.data.rules } : {}),
        actorUserId: getAuthUser(req).userId,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/lifecycle/log', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
      if (status && status !== 'QUEUED' && status !== 'SENT' && status !== 'FAILED') {
        return res.status(400).json(badRequest('Invalid status filter'));
      }
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      res.json({
        notifications: await emailNotificationService.listNotifications({
          ...(status ? { status: status as 'QUEUED' | 'SENT' | 'FAILED' } : {}),
          ...(limit !== undefined ? { limit } : {}),
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { businessAnalyticsService } from '../../services/businessAnalyticsService.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';

/**
 * Phase 15.8 - Business analytics dashboard API.
 *
 * Platform administrators only. The window defaults to 30 days and is capped at
 * a year; every number is read from platform data rather than estimated.
 */

const reportQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export function createBusinessAnalyticsRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const admin = [requireAuth, requirePlatformAdmin()] as RequestHandler[];

  router.get('/', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = reportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid query parameters' } });
      }
      res.json(await businessAnalyticsService.report({ days: parsed.data.days }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

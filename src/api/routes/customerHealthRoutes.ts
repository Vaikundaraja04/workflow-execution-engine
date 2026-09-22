import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { customerHealthService } from '../../services/customerHealthService.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { getAuthUser } from '../../auth/auth.middleware.js';

const portfolioQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  band: z.enum(['healthy', 'watch', 'at_risk'] as const).optional(),
  tenantStatus: z.enum(['TRIALING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const).optional(),
  demo: z.coerce.boolean().optional(),
});

export function createCustomerHealthRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const admin = [requireAuth, requirePlatformAdmin()] as RequestHandler[];

  router.get('/', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = portfolioQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid query parameters' } });
      }
      const actorUserId = getAuthUser(req).userId;
      const result = await customerHealthService.portfolio({
        ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
        ...(parsed.data.band !== undefined ? { band: parsed.data.band } : {}),
        ...(parsed.data.tenantStatus !== undefined ? { tenantStatus: parsed.data.tenantStatus } : {}),
        ...(parsed.data.demo !== undefined ? { demo: parsed.data.demo } : {}),
        actorUserId,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:workspaceId', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await customerHealthService.evaluate(req.params.workspaceId as string, {
        actorUserId: getAuthUser(req).userId,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

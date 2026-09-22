import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { customerSuccessService } from '../../services/customerSuccessService.js';
import { requireMembership } from '../middleware/requirePermission.js';
import { isPlatformAdminEmail } from '../middleware/platformAdmin.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { UserModel } from '../../models/UserModel.js';

/**
 * Phase 16.4 - Customer success API.
 *
 * The portfolio is platform-administrator only (it reads across tenants). The
 * single-customer route allows the tenant's own members as well, so a workspace
 * can see its own health without belonging to the platform team - a member of
 * another workspace gets the same 404 as a missing tenant.
 */

const portfolioQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  category: z.enum(['Healthy', 'At Risk', 'Critical'] as const).optional(),
  tenantStatus: z.enum(['TRIALING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const).optional(),
  demo: z.coerce.boolean().optional(),
});

async function isPlatformAdminUser(userId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(userId)) return false;
  const user = await UserModel.findById(userId).select('email').lean();
  return user?.email ? isPlatformAdminEmail(user.email) : false;
}

export function createCustomerSuccessRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const memberGuard = requireMembership({ workspaceParam: 'workspaceId' });

  const adminOrMember: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        if (await isPlatformAdminUser(getAuthUser(req).userId)) return next();
        return memberGuard(req, res, next);
      } catch (error) {
        next(error);
      }
    })();
  };

  router.get('/health', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await isPlatformAdminUser(getAuthUser(req).userId))) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Platform administrators only' } });
      }
      const parsed = portfolioQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid query parameters' } });
      }
      res.json(await customerSuccessService.portfolio({
        ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
        ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
        ...(parsed.data.tenantStatus !== undefined ? { tenantStatus: parsed.data.tenantStatus } : {}),
        ...(parsed.data.demo !== undefined ? { demo: parsed.data.demo } : {}),
        actorUserId: getAuthUser(req).userId,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:workspaceId/health', requireAuth, adminOrMember, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      if (!Types.ObjectId.isValid(workspaceId)) {
        return res.status(400).json({ error: { code: 'INVALID_WORKSPACE_ID', message: 'Invalid workspace ID' } });
      }
      res.json(await customerSuccessService.evaluate(workspaceId, {
        actorUserId: getAuthUser(req).userId,
      }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createRequireAuth } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { activityService } from '../../services/activityService.js';

export function createActivityRouter(requireAuth: ReturnType<typeof createRequireAuth>): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth,
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const { userId, resource, action, startDate, endDate, limit, offset } = req.query;

        const result = await activityService.getWorkspaceActivity(
          workspaceContext.workspaceId,
          workspaceContext.userId,
          {
            userId: typeof userId === 'string' ? userId : undefined,
            resource: typeof resource === 'string' ? resource : undefined,
            action: typeof action === 'string' ? action : undefined,
            startDate: typeof startDate === 'string' ? startDate : undefined,
            endDate: typeof endDate === 'string' ? endDate : undefined,
            limit: limit ? parseInt(limit as string, 10) : undefined,
            offset: offset ? parseInt(offset as string, 10) : undefined,
          },
        );

        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

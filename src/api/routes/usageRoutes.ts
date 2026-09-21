import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { getWorkspaceContext, requireMembership } from '../middleware/requirePermission.js';
import { requireActiveTenant } from '../middleware/requireEntitlement.js';
import { usageMeteringService } from '../../services/usageMeteringService.js';

export function createUsageRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireActiveTenant(),
    requireMembership(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const summary = await usageMeteringService.getSummary(workspaceId);
        res.json(summary);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/history',
    requireActiveTenant(),
    requireMembership(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const days = typeof req.query.days === 'string' ? Number(req.query.days) : 30;
        const history = await usageMeteringService.getHistory(workspaceId, days);
        res.json(history);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

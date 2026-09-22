import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { featureEntitlementService } from '../../services/featureEntitlementService.js';
import { requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { requireActiveTenant } from '../middleware/requireEntitlement.js';
import { isFeatureKey } from '../../models/ProductPlanModel.js';

export function createEntitlementRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const customerGuard = [requireAuth, requireActiveTenant(), requireMembership()];

  router.get('/', customerGuard, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = getWorkspaceContext(_req);
      res.json(await featureEntitlementService.getSummary(workspaceId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:feature', customerGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const feature = req.params.feature;
      if (!isFeatureKey(feature)) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Unknown feature key' } });
      }
      const { workspaceId } = getWorkspaceContext(req);
      res.json(await featureEntitlementService.evaluate(workspaceId, feature));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router } from 'express';
import { platformService } from '../../services/platformService.js';

export function createPlatformRouter(): Router {
  const router = Router();

  router.get('/regions', async (_req, res, next) => {
    try {
      const data = await platformService.getRegions();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/infrastructure', async (_req, res, next) => {
    try {
      const data = await platformService.getInfrastructureHealth();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/tenants', async (_req, res, next) => {
    try {
      const data = await platformService.getTenantDistribution();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/deployments', async (_req, res, next) => {
    try {
      const data = await platformService.getDeployments();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/metrics', async (_req, res, next) => {
    try {
      const data = await platformService.getGlobalMetrics();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createPlatformRouter;

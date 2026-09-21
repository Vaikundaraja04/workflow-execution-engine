import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { AutonomousOptimizationService } from '../../services/autonomousOptimizationService.js';

export function createOptimizationRouter(): Router {
  const router = Router();
  const optimizationService = AutonomousOptimizationService.getInstance();

  // GET /api/v1/optimization/workflows/:id/analyze
  router.get(
    '/workflows/:id/analyze',
    requirePermission('AI_OPTIMIZATION_READ', { workflowParam: 'id' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = (req as any).workspaceContext;
        const rawId = req.params.id;
        const workflowId = typeof rawId === 'string' ? rawId : '';
        const result = await optimizationService.analyzeWorkflow(
          workflowId,
          workspaceContext.workspaceId,
          workspaceContext.userId,
        );
        res.json({ data: result });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/v1/optimization/workflows/:id/generate-plan
  router.post(
    '/workflows/:id/generate-plan',
    requirePermission('AI_OPTIMIZATION_CREATE', { workflowParam: 'id' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = (req as any).workspaceContext;
        const rawId = req.params.id;
        const workflowId = typeof rawId === 'string' ? rawId : '';
        const plan = await optimizationService.generateOptimizationPlan(
          workflowId,
          workspaceContext.workspaceId,
          workspaceContext.userId,
        );
        res.status(201).json({ data: plan });
      } catch (err) {
        next(err);
      }
    },
  );
  // GET /api/v1/optimization/plans
  router.get('/plans', requirePermission('AI_OPTIMIZATION_READ'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const filters: { status?: string; workflowId?: string } = {};
      if (typeof req.query.status === 'string') filters.status = req.query.status;
      if (typeof req.query.workflowId === 'string') filters.workflowId = req.query.workflowId;
      const plans = await optimizationService.listPlans(workspaceContext.workspaceId, filters);
      res.json({ data: plans });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/optimization/plans/:id
  router.get('/plans/:id', requirePermission('AI_OPTIMIZATION_READ'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const planId = typeof rawId === 'string' ? rawId : '';
      const plan = await optimizationService.getPlanById(planId, workspaceContext.workspaceId);
      if (!plan) {
        return res.status(404).json({ error: 'Optimization plan not found' });
      }
      res.json({ data: plan });
    } catch (err) {
      next(err);
    }
  });
  // POST /api/v1/optimization/plans/:id/approve
  router.post('/plans/:id/approve', requirePermission('AI_OPTIMIZATION_APPROVE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const planId = typeof rawId === 'string' ? rawId : '';
      const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
      const plan = await optimizationService.approvePlan(planId, workspaceContext.userId, workspaceContext.workspaceId, note);
      res.json({ data: plan });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/optimization/plans/:id/reject
  router.post('/plans/:id/reject', requirePermission('AI_OPTIMIZATION_APPROVE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const planId = typeof rawId === 'string' ? rawId : '';
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const plan = await optimizationService.rejectPlan(planId, workspaceContext.userId, workspaceContext.workspaceId, reason);
      res.json({ data: plan });
    } catch (err) {
      next(err);
    }
  });
  // POST /api/v1/optimization/plans/:id/apply
  router.post('/plans/:id/apply', requirePermission('AI_OPTIMIZATION_CREATE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const planId = typeof rawId === 'string' ? rawId : '';
      const result = await optimizationService.applyPlan(planId, workspaceContext.userId, workspaceContext.workspaceId);
      if (!result.applied) {
        return res.status(422).json({
          error: {
            code: 'OPTIMIZATION_VALIDATION_FAILED',
            message: 'Optimized definition failed validation',
            details: result.validationErrors,
          },
          data: { plan: result.plan },
        });
      }
      res.json({ data: { plan: result.plan, version: result.version, beforeAfter: result.beforeAfter } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createOptimizationRouter;
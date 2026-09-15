import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import {
  getExecutionMetrics,
  getWorkflowAnalytics,
  getWorkspaceAnalytics,
} from '../../services/analyticsService.js';

function getRouteParameter(req: Request, name: string, errorCode: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(errorCode);
  return value;
}

export function createAnalyticsRouter(): Router {
  const router = Router();

  const requireWorkflowRead = requirePermission('WORKFLOW_READ', { workflowParam: 'id' });
  const requireExecutionRead = requirePermission('WORKFLOW_READ', { executionParam: 'executionId' });
  const requireWorkspaceAudit = requirePermission('AUDIT_READ', { workspaceParam: 'id' });

  router.get('/workflows/:id', requireWorkflowRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workflowId = getRouteParameter(req, 'id', 'INVALID_WORKFLOW_ID');
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const analytics = await getWorkflowAnalytics(workflowId, getAuthUser(req).userId, workspaceId);
      res.json(analytics);
    } catch (error) {
      next(error);
    }
  });

  router.get('/executions/:executionId', requireExecutionRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const metrics = await getExecutionMetrics(executionId, getAuthUser(req).userId, workspaceId);
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  });

  router.get('/workspaces/:id', requireWorkspaceAudit, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteParameter(req, 'id', 'INVALID_WORKSPACE_ID');
      const analytics = await getWorkspaceAnalytics(workspaceId);
      res.json(analytics);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
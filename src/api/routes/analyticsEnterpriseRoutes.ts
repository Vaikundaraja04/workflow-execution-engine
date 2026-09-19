import { Router } from 'express';
import { EnterpriseAnalyticsService } from '../../services/enterpriseAnalyticsService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import type { Request, Response, NextFunction } from 'express';

export function createAnalyticsEnterpriseRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route GET /api/v1/analytics/overview
   * @desc Get workspace high-level KPI and execution trend overview
   * @access Private (requires WORKFLOW_READ or AUDIT_READ)
   */
  router.get(
    '/overview',
    requirePermission('WORKFLOW_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const timeframe = (req.query.timeframe as string) || '30d';
        const overview = await EnterpriseAnalyticsService.getOverviewAnalytics(workspaceId, timeframe);
        res.json(overview);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/analytics/workflows
   * @desc Get workflow health, reliability, and most failing nodes
   * @access Private (requires WORKFLOW_READ)
   */
  router.get(
    '/workflows',
    requirePermission('WORKFLOW_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const timeframe = (req.query.timeframe as string) || '30d';
        const workflows = await EnterpriseAnalyticsService.getWorkflowAnalytics(workspaceId, timeframe);
        res.json(workflows);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/analytics/executions
   * @desc Get detailed execution analytics (hourly throughput, status breakdown, latency percentiles)
   * @access Private (requires WORKFLOW_READ)
   */
  router.get(
    '/executions',
    requirePermission('WORKFLOW_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const timeframe = (req.query.timeframe as string) || '30d';
        const executions = await EnterpriseAnalyticsService.getExecutionAnalytics(workspaceId, timeframe);
        res.json(executions);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/analytics/users
   * @desc Get member productivity and activity statistics
   * @access Private (requires AUDIT_READ)
   */
  router.get(
    '/users',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const timeframe = (req.query.timeframe as string) || '30d';
        const users = await EnterpriseAnalyticsService.getUserAnalytics(workspaceId, timeframe);
        res.json(users);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/analytics/performance
   * @desc Get latency percentiles (p50, p95, p99), slowest workflows, and node execution timings
   * @access Private (requires WORKFLOW_READ)
   */
  router.get(
    '/performance',
    requirePermission('WORKFLOW_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const timeframe = (req.query.timeframe as string) || '30d';
        const performance = await EnterpriseAnalyticsService.getPerformanceAnalytics(workspaceId, timeframe);
        res.json(performance);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/analytics/cost
   * @desc Get compute, AI token, and storage cost breakdown per workflow
   * @access Private (requires AUDIT_READ)
   */
  router.get(
    '/cost',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const timeframe = (req.query.timeframe as string) || '30d';
        const cost = await EnterpriseAnalyticsService.getCostAnalytics(workspaceId, timeframe);
        res.json(cost);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/analytics/export
   * @desc Export analytics data in JSON or CSV format
   * @access Private (requires AUDIT_READ)
   */
  router.get(
    '/export',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const type = (req.query.type as string) || 'overview';
        const format = ((req.query.format as string) || 'json').toLowerCase() as 'json' | 'csv';

        const exported = await EnterpriseAnalyticsService.exportAnalyticsData(workspaceId, type, format);

        res.setHeader('Content-Type', exported.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
        res.send(exported.data);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createAnalyticsEnterpriseRouter;

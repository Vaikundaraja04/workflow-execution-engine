import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import {
  suspendWorkspace,
  unsuspendWorkspace,
  deleteWorkspace,
  getWorkspaceAdminDetail,
  listAdminWorkspaces,
  getWorkspaceUsageMetrics,
  getWorkspaceQuotas,
  getSecurityOverview,
  getSecurityEvents,
  getSystemHealth,
  getSystemMetrics,
  triggerRecalculateAnalytics,
} from '../../services/adminService.js';
import { createHealthChecks } from './healthRoutes.js';
import type { HealthOptions } from './healthRoutes.js';

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).optional(),
});

function getRouteWorkspaceId(req: Request): string {
  const id = req.params.workspaceId ?? req.params.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('INVALID_WORKSPACE_ID');
  return id;
}

export function createAdminRouter(healthOptions: HealthOptions = {}): Router {
  const router = Router({ mergeParams: true });
  const healthChecks = createHealthChecks(healthOptions);

  const requireAdminAccess = requirePermission('MEMBER_MANAGE');
  const requireAuditRead = requirePermission('AUDIT_READ', { workspaceParam: 'workspaceId' });
  const requireAuditReadDefault = requirePermission('AUDIT_READ');

  // =============================================================
  // 1. System Administration API
  // =============================================================

  // GET /system/health - System health status
  router.get('/system/health', requireAdminAccess, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const health = await getSystemHealth(healthChecks);
      const statusCode = health.status === 'unavailable' ? 503 : 200;
      res.status(statusCode).json(health);
    } catch (error) {
      next(error);
    }
  });

  // GET /system/metrics or /system/stats - System-wide metrics
  const handleSystemMetrics = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const metrics = await getSystemMetrics();
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  };

  router.get('/system/metrics', requireAdminAccess, handleSystemMetrics);
  router.get('/system/stats', requireAdminAccess, handleSystemMetrics);

  // POST /system/maintenance/recalculate-analytics - Recalculate rollups
  router.post('/system/maintenance/recalculate-analytics', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      const workspaceId = req.body?.workspaceId as string | undefined;
      const result = await triggerRecalculateAnalytics(workspaceId, user.userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // =============================================================
  // 2. Security Center API
  // =============================================================

  // GET /security/overview - Security posture of current workspace
  router.get('/security/overview', requireAuditReadDefault, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const overview = await getSecurityOverview(workspaceId);
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  // GET /security/events - Security events for current workspace
  router.get('/security/events', requireAuditReadDefault, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = paginationQuerySchema.safeParse(req.query);
      const query = parsed.success ? parsed.data : { limit: 50, offset: 0, page: undefined };
      const offset = query.page !== undefined ? (query.page - 1) * query.limit : query.offset;

      const workspaceId = getWorkspaceContext(req).workspaceId;
      const events = await getSecurityEvents(workspaceId, { limit: query.limit, offset });
      res.json(events);
    } catch (error) {
      next(error);
    }
  });

  // Parameterized security endpoints
  router.get('/workspaces/:workspaceId/security/overview', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const overview = await getSecurityOverview(workspaceId);
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  router.get('/workspaces/:workspaceId/security/events', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = paginationQuerySchema.safeParse(req.query);
      const query = parsed.success ? parsed.data : { limit: 50, offset: 0, page: undefined };
      const offset = query.page !== undefined ? (query.page - 1) * query.limit : query.offset;

      const workspaceId = getRouteWorkspaceId(req);
      const events = await getSecurityEvents(workspaceId, { limit: query.limit, offset });
      res.json(events);
    } catch (error) {
      next(error);
    }
  });

  router.get('/workspaces/:workspaceId/security', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const overview = await getSecurityOverview(workspaceId);
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  // =============================================================
  // 3. Usage & Quota API
  // =============================================================

  // GET /usage - Usage metrics for current workspace
  router.get('/usage', requireAuditReadDefault, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const metrics = await getWorkspaceUsageMetrics(workspaceId);
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  });

  // GET /quotas - Quota limits and usage for current workspace
  router.get('/quotas', requireAuditReadDefault, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const quotas = await getWorkspaceQuotas(workspaceId);
      res.json(quotas);
    } catch (error) {
      next(error);
    }
  });

  // Parameterized usage and quotas
  router.get('/workspaces/:workspaceId/usage', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const metrics = await getWorkspaceUsageMetrics(workspaceId);
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  });

  router.get('/workspaces/:workspaceId/quotas', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const quotas = await getWorkspaceQuotas(workspaceId);
      res.json(quotas);
    } catch (error) {
      next(error);
    }
  });

  // =============================================================
  // 4. Workspace Administration API
  // =============================================================

  // GET /workspaces - List all workspaces user administers
  router.get('/workspaces', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      const workspaces = await listAdminWorkspaces(user.userId);
      res.json(workspaces);
    } catch (error) {
      next(error);
    }
  });

  // GET /workspaces/:workspaceId (and /workspaces/:workspaceId/overview)
  const handleGetWorkspaceAdminDetail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const user = getAuthUser(req);
      const detail = await getWorkspaceAdminDetail(workspaceId, user.userId);
      res.json(detail);
    } catch (error) {
      next(error);
    }
  };

  router.get('/workspaces/:workspaceId/overview', requireAuditRead, handleGetWorkspaceAdminDetail);
  router.get('/workspaces/:workspaceId', requireAuditRead, handleGetWorkspaceAdminDetail);

  // POST /workspaces/:workspaceId/suspend - Suspend workspace (Owner only)
  router.post('/workspaces/:workspaceId/suspend', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const user = getAuthUser(req);
      const detail = await suspendWorkspace(workspaceId, user.userId);
      res.json(detail);
    } catch (error) {
      next(error);
    }
  });

  // POST /workspaces/:workspaceId/unsuspend & /activate - Unsuspend workspace (Owner only)
  const handleUnsuspend = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const user = getAuthUser(req);
      const detail = await unsuspendWorkspace(workspaceId, user.userId);
      res.json(detail);
    } catch (error) {
      next(error);
    }
  };

  router.post('/workspaces/:workspaceId/unsuspend', handleUnsuspend);
  router.post('/workspaces/:workspaceId/activate', handleUnsuspend);

  // DELETE /workspaces/:workspaceId - Soft delete workspace (Owner only)
  router.delete('/workspaces/:workspaceId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getRouteWorkspaceId(req);
      const user = getAuthUser(req);
      const detail = await deleteWorkspace(workspaceId, user.userId);
      res.json(detail);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

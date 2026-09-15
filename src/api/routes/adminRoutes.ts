import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { Types } from 'mongoose';
import type { SubscriptionPlan, SubscriptionStatus } from '../../models/SubscriptionModel.js';
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
  getWorkerPoolMetrics,
  getAdminBillingWorkspaces,
  getAdminBillingRevenue,
  getAdminBillingSubscriptions,
} from '../../services/adminService.js';
import { WorkspaceMemberModel } from '../../models/WorkspaceMemberModel.js';
import { createHealthChecks } from './healthRoutes.js';
import type { HealthOptions } from './healthRoutes.js';
import { runDataRetention, DEFAULT_RETENTION_POLICY } from '../../services/retentionService.js';
import type { RetentionExecutionOptions, RetentionPolicy } from '../../services/retentionService.js';
import { getDatabaseOptimizationReport } from '../../services/databaseOptimizationService.js';
import {
  setMaintenanceMode,
  getMaintenanceMode,
  createDisasterRecoverySnapshot,
  validateDisasterRecoverySnapshot,
} from '../../services/disasterRecoveryService.js';
import { createAuditLog } from '../../services/auditService.js';
import type { ExecutionQueue } from '../../queues/executionQueue.js';
import { UnavailableExecutionQueue } from '../../queues/executionQueue.js';
import type { WebhookQueue } from '../../queues/webhookQueue.js';
import { UnavailableWebhookQueue } from '../../queues/webhookQueue.js';
import {
  cancelWorkflowExecution,
  retryWorkflowExecution,
  toWorkflowExecutionView,
} from '../../services/executionService.js';
import { CreateExecutionRequestSchema } from '../../schemas/executionSchema.js';
import type { ExecutionCreationOptions } from '../../services/executionService.js';

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).optional(),
});

export interface AdminRouterOptions {
  health?: HealthOptions;
  executionQueue?: ExecutionQueue;
  webhookQueue?: WebhookQueue;
}

function getRouteWorkspaceId(req: Request): string {
  const id = req.params.workspaceId ?? req.params.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('INVALID_WORKSPACE_ID');
  return id;
}

function getRouteParameter(req: Request, name: string, errorCode: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new Error(errorCode);
  return value;
}

function getRouteQueueName(req: Request): 'execution' | 'webhook' {
  const name = req.params.queueName;
  if (name === 'execution' || name === 'workflow-executions') return 'execution';
  if (name === 'webhook' || name === 'webhook-delivery' || name === 'webhooks') return 'webhook';
  throw new Error('INVALID_QUEUE_NAME');
}

export function createAdminRouter(options: HealthOptions | AdminRouterOptions = {}): Router {
  const router = Router({ mergeParams: true });

  const healthOptions: HealthOptions = 'health' in options && options.health
    ? options.health
    : (options as HealthOptions);

  const executionQueue: ExecutionQueue = ('executionQueue' in options && options.executionQueue)
    ? options.executionQueue
    : new UnavailableExecutionQueue();

  const webhookQueue: WebhookQueue = ('webhookQueue' in options && options.webhookQueue)
    ? options.webhookQueue
    : new UnavailableWebhookQueue();

  const healthChecks = createHealthChecks(healthOptions);

  const requireAdminAccess = requirePermission('MEMBER_MANAGE');
  const requireAuditRead = requirePermission('AUDIT_READ', { workspaceParam: 'workspaceId' });
  const requireAuditReadDefault = requirePermission('AUDIT_READ');

  // =============================================================
  // 1. System Administration & Worker Management API
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

  // GET /system/workers or /system/workers/metrics - Worker Pool & Autoscaling Metrics
  const handleWorkerMetrics = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const workerMetrics = await getWorkerPoolMetrics(healthChecks, executionQueue, webhookQueue);
      res.json(workerMetrics);
    } catch (error) {
      next(error);
    }
  };

  router.get('/system/workers', requireAdminAccess, handleWorkerMetrics);
  router.get('/system/workers/metrics', requireAdminAccess, handleWorkerMetrics);
  router.get('/workers/metrics', requireAdminAccess, handleWorkerMetrics);

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
  // 2. Queue Monitoring & Control API
  // =============================================================

  // GET /queues - Metrics for all queues
  router.get('/queues', requireAdminAccess, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [executionMetrics, webhookMetrics] = await Promise.all([
        executionQueue.getMetrics ? executionQueue.getMetrics() : { name: 'workflow-executions', isPaused: false, counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 }, total: 0 },
        webhookQueue.getMetrics ? webhookQueue.getMetrics() : { name: 'webhook-delivery', isPaused: false, counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 }, total: 0 },
      ]);
      res.json({
        execution: executionMetrics,
        webhook: webhookMetrics,
        queues: [executionMetrics, webhookMetrics],
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /queues/:queueName and /queues/:queueName/metrics
  const handleSingleQueueMetrics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const queueType = getRouteQueueName(req);
      const targetQueue = queueType === 'execution' ? executionQueue : webhookQueue;
      const metrics = targetQueue.getMetrics
        ? await targetQueue.getMetrics()
        : {
            name: queueType === 'execution' ? 'workflow-executions' : 'webhook-delivery',
            isPaused: false,
            counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
            total: 0,
          };
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  };

  router.get('/queues/:queueName', requireAdminAccess, handleSingleQueueMetrics);
  router.get('/queues/:queueName/metrics', requireAdminAccess, handleSingleQueueMetrics);

  // POST /queues/:queueName/pause
  router.post('/queues/:queueName/pause', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const queueType = getRouteQueueName(req);
      const targetQueue = queueType === 'execution' ? executionQueue : webhookQueue;
      if (targetQueue.pause) {
        await targetQueue.pause();
      }
      const user = getAuthUser(req);
      await createAuditLog({
        action: 'QUEUE_PAUSED',
        userId: user.userId,
        resource: 'queue',
        resourceId: queueType,
        metadata: { queue: queueType },
      });
      res.json({ success: true, queue: queueType, paused: true });
    } catch (error) {
      next(error);
    }
  });

  // POST /queues/:queueName/resume
  router.post('/queues/:queueName/resume', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const queueType = getRouteQueueName(req);
      const targetQueue = queueType === 'execution' ? executionQueue : webhookQueue;
      if (targetQueue.resume) {
        await targetQueue.resume();
      }
      const user = getAuthUser(req);
      await createAuditLog({
        action: 'QUEUE_RESUMED',
        userId: user.userId,
        resource: 'queue',
        resourceId: queueType,
        metadata: { queue: queueType },
      });
      res.json({ success: true, queue: queueType, paused: false });
    } catch (error) {
      next(error);
    }
  });

  // =============================================================
  // 3. Execution Control API (Admin)
  // =============================================================

  // POST /executions/:executionId/cancel
  router.post('/executions/:executionId/cancel', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
      const user = getAuthUser(req);
      const reason = req.body?.reason as string | undefined;
      const cancelled = await cancelWorkflowExecution(
        executionQueue,
        executionId,
        user.userId,
        undefined,
        reason,
      );
      res.json(toWorkflowExecutionView(cancelled));
    } catch (error) {
      next(error);
    }
  });

  // POST /executions/:executionId/retry
  router.post('/executions/:executionId/retry', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
      const user = getAuthUser(req);
      const parsed = CreateExecutionRequestSchema.safeParse(req.body);
      const options: ExecutionCreationOptions = {};
      if (parsed.success && parsed.data.timeoutMs !== undefined) {
        options.timeoutMs = parsed.data.timeoutMs;
      }
      const retried = await retryWorkflowExecution(
        executionQueue,
        executionId,
        user.userId,
        undefined,
        options,
      );
      res.json(toWorkflowExecutionView(retried));
    } catch (error) {
      next(error);
    }
  });

  // =============================================================
  // 4. Data Retention Framework API
  // =============================================================

  // POST /system/retention/run
  router.post('/system/retention/run', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      const options: RetentionExecutionOptions = {
        ...(typeof req.body?.workspaceId === 'string' ? { workspaceId: req.body.workspaceId } : {}),
        dryRun: req.body?.dryRun === true,
        ...(req.body?.policies ? { policies: req.body.policies as Partial<RetentionPolicy> } : {}),
        actorUserId: user.userId,
      };
      const result = await runDataRetention(options);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // GET /system/retention/policies
  router.get('/system/retention/policies', requireAdminAccess, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(DEFAULT_RETENTION_POLICY);
    } catch (error) {
      next(error);
    }
  });

  // =============================================================
  // 5. Database Optimization Review API
  // =============================================================

  // GET /system/database/optimization or /database/optimization
  const handleDatabaseOptimization = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await getDatabaseOptimizationReport();
      res.json(report);
    } catch (error) {
      next(error);
    }
  };

  router.get('/system/database/optimization', requireAdminAccess, handleDatabaseOptimization);
  router.get('/database/optimization', requireAdminAccess, handleDatabaseOptimization);

  // =============================================================
  // 6. Disaster Recovery Foundations API
  // =============================================================

  // GET /system/maintenance/mode
  router.get('/system/maintenance/mode', requireAdminAccess, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = getMaintenanceMode();
      res.json(state);
    } catch (error) {
      next(error);
    }
  });

  // POST /system/maintenance/mode
  router.post('/system/maintenance/mode', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      const enabled = req.body?.enabled === true;
      const reason = req.body?.reason as string | undefined;
      const pauseQueues = req.body?.pauseQueues !== false;

      const state = await setMaintenanceMode(enabled, user.userId, {
        ...(reason !== undefined ? { reason } : {}),
        pauseQueues,
        executionQueue,
        webhookQueue,
      });
      res.json(state);
    } catch (error) {
      next(error);
    }
  });

  // POST /system/disaster-recovery/snapshot
  router.post('/system/disaster-recovery/snapshot', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      const workspaceId = req.body?.workspaceId as string | undefined;
      const snapshot = await createDisasterRecoverySnapshot({
        ...(typeof workspaceId === 'string' ? { workspaceId } : {}),
        actorUserId: user.userId,
      });
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  // POST /system/disaster-recovery/snapshot/validate
  router.post('/system/disaster-recovery/snapshot/validate', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const snapshot = req.body?.snapshot ?? req.body;
      if (!snapshot) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Snapshot is required' } });
      }
      const validation = validateDisasterRecoverySnapshot(snapshot);
      res.json(validation);
    } catch (error) {
      next(error);
    }
  });

  // =============================================================
  // 7. Security Center API
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
  // 8. Usage & Quota API
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
  // 9. Workspace Administration API
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

  // =============================================================
  // 10. Billing Administration API (Owner only)
  // =============================================================

  // GET /billing/workspaces - List all workspaces with billing info (Owner only)
  router.get('/billing/workspaces', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      // Additional check: ensure user is OWNER (not just ADMIN) for billing access
      const membership = await WorkspaceMemberModel.findOne({
        userId: new Types.ObjectId(user.userId),
        role: 'OWNER',
        status: 'ACTIVE',
      });
      if (!membership) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner access required for billing' } });
      }

      const workspaces = await getAdminBillingWorkspaces(user.userId);
      res.json(workspaces);
    } catch (error) {
      next(error);
    }
  });

  // GET /billing/revenue - Get billing revenue metrics (Owner only)
  router.get('/billing/revenue', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      // Additional check: ensure user is OWNER (not just ADMIN) for billing access
      const membership = await WorkspaceMemberModel.findOne({
        userId: new Types.ObjectId(user.userId),
        role: 'OWNER',
        status: 'ACTIVE',
      });
      if (!membership) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner access required for billing' } });
      }

      const filters: { period?: string } = {};
      if (req.query.period) {
        filters.period = req.query.period as string;
      }
      const revenue = await getAdminBillingRevenue(user.userId, filters);
      res.json(revenue);
    } catch (error) {
      next(error);
    }
  });

  // GET /billing/subscriptions - Get subscription list with filters (Owner only)
  router.get('/billing/subscriptions', requireAdminAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      // Additional check: ensure user is OWNER (not just ADMIN) for billing access
      const membership = await WorkspaceMemberModel.findOne({
        userId: new Types.ObjectId(user.userId),
        role: 'OWNER',
        status: 'ACTIVE',
      });
      if (!membership) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner access required for billing' } });
      }

      const filters: Record<string, SubscriptionPlan | SubscriptionStatus | undefined> = {};
      if (req.query.plan) {
        filters.plan = req.query.plan as SubscriptionPlan;
      }
      if (req.query.status) {
        filters.status = req.query.status as SubscriptionStatus;
      }

      const subscriptions = await getAdminBillingSubscriptions(user.userId, filters);
      res.json(subscriptions);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

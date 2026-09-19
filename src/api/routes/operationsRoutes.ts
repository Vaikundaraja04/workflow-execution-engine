import { Router } from 'express';
import { ObservabilityService } from '../../services/observabilityService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { AuditLogModel } from '../../models/AuditLogModel.js';
import { Types } from 'mongoose';
import type { Request, Response, NextFunction } from 'express';

export function createOperationsRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route GET /api/v1/operations/health
   * @desc Get operational health across database, Redis, queues, workers, and WebSockets
   * @access Private (requires WORKFLOW_READ or OPERATIONS_READ)
   */
  router.get(
    '/health',
    requirePermission('WORKFLOW_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const health = await ObservabilityService.getSystemHealth();
        res.json(health);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/operations/metrics
   * @desc Get real-time system metrics (CPU, memory, queue depth, throughput RPM, error rate)
   * @access Private (requires WORKFLOW_READ or OPERATIONS_READ)
   */
  router.get(
    '/metrics',
    requirePermission('WORKFLOW_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const metrics = await ObservabilityService.getSystemMetrics();

        // Audit log on viewing operations metrics
        try {
          const { workspaceId } = getWorkspaceContext(req);
          const { userId } = getAuthUser(req);
          if (workspaceId && userId && Types.ObjectId.isValid(workspaceId) && Types.ObjectId.isValid(userId)) {
            await AuditLogModel.create({
              workspaceId: new Types.ObjectId(workspaceId),
              userId: new Types.ObjectId(userId),
              action: 'OPERATIONS_METRICS_VIEWED',
              resource: 'SystemMetrics',
              resourceId: 'realtime',
            });
          }
        } catch {
          // Non-blocking audit log
        }

        res.json(metrics);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/operations/system
   * @desc Get consolidated system status with health, telemetry, and environment summary
   * @access Private (requires WORKFLOW_READ or OPERATIONS_READ)
   */
  router.get(
    '/system',
    requirePermission('WORKFLOW_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const [health, metrics] = await Promise.all([
          ObservabilityService.getSystemHealth(),
          ObservabilityService.getSystemMetrics(),
        ]);

        res.json({
          status: health.status,
          uptimeSeconds: health.uptimeSeconds,
          timestamp: health.timestamp,
          environment: process.env.NODE_ENV || 'production',
          nodeVersion: process.version,
          services: health.services,
          metrics,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createOperationsRouter;

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { securityAuditService } from '../../services/securityAuditService.js';
import { performanceBenchmarkService } from '../../services/performanceBenchmarkService.js';
import { getIndexVerificationReport } from '../../services/databaseOptimizationService.js';
import { releaseReadinessService } from '../../services/releaseReadinessService.js';
import { enterpriseMetricsService } from '../../services/enterpriseMetricsService.js';
import { observabilityCollectorService } from '../../services/observabilityCollectorService.js';
import { continuousReadinessService } from '../../services/continuousReadinessService.js';
import { productionAlertService } from '../../services/productionAlertService.js';

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (!(err instanceof Error)) {
    next(err);
    return;
  }
  if (err.message === 'INVALID_REQUEST') {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
    return;
  }
  if (err.message === 'PRODUCTION_ALERT_NOT_FOUND') {
    res.status(404).json({ error: { code: 'PRODUCTION_ALERT_NOT_FOUND', message: 'Production alert not found' } });
    return;
  }
  next(err);
}

export function createReleaseReadinessRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/security-audit',
    requirePermission('SECURITY_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = getAuthUser(req);
        const report = await securityAuditService.runSecurityAudit(userId);
        res.json({ data: report });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/performance',
    requirePermission('OPERATIONS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const report = await performanceBenchmarkService.runBenchmark(workspaceId, userId);
        res.json({ data: report });
      } catch (err) { handleError(err, res, next); }
    },
  );
  router.get(
    '/database',
    requirePermission('OPERATIONS_READ'),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const report = await getIndexVerificationReport();
        res.json({ data: report });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/disaster-recovery',
    requirePermission('OPERATIONS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const report = await releaseReadinessService.validateDisasterRecovery(workspaceId, userId);
        res.json({ data: report });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/deployment',
    requirePermission('OPERATIONS_READ'),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const report = releaseReadinessService.validateDeployment();
        res.json({ data: report });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/metrics',
    requirePermission('OPERATIONS_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const raw = Number(req.query.windowHours);
        const report = await enterpriseMetricsService.getEnterpriseMetrics(
          workspaceId,
          Number.isFinite(raw) && raw > 0 ? raw : undefined,
        );
        res.json({ data: report });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/readiness',
    requirePermission('OPERATIONS_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = getAuthUser(req);
        const report = await releaseReadinessService.getReadinessReport(userId);
        res.json({ data: report });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/live',
    requirePermission('OPERATIONS_READ'),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const snapshot = await observabilityCollectorService.collectSnapshot();
        res.json({ data: snapshot });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/metrics-history',
    requirePermission('OPERATIONS_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const resolution = typeof req.query.resolution === 'string' ? req.query.resolution : undefined;
        const history = await observabilityCollectorService.getMetricsHistory({
          ...(resolution ? { resolution } : {}),
          hours: Number(req.query.hours),
        });
        res.json({ data: history });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/history',
    requirePermission('OPERATIONS_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const limit = Number(req.query.limit);
        const scans = await continuousReadinessService.getScanHistory({
          workspaceId,
          ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
        });
        res.json({ data: { scans } });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.post(
    '/scan',
    requirePermission('OPERATIONS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const scan = await continuousReadinessService.runScan({ workspaceId, actorUserId: userId });
        res.status(201).json({ data: scan });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.get(
    '/alerts',
    requirePermission('OPERATIONS_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const type = typeof req.query.type === 'string' ? req.query.type : undefined;
        const alerts = await productionAlertService.listAlerts({
          workspaceId,
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
          limit: Number(req.query.limit),
        });
        res.json({ data: { alerts } });
      } catch (err) { handleError(err, res, next); }
    },
  );

  router.post(
    '/alerts/:id/acknowledge',
    requirePermission('OPERATIONS_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = getAuthUser(req);
        const alert = await productionAlertService.acknowledgeAlert(String(req.params.id), userId);
        res.json({ data: alert });
      } catch (err) { handleError(err, res, next); }
    },
  );

  return router;
}

export default createReleaseReadinessRouter;

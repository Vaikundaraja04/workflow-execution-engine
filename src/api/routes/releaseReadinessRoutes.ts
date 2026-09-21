import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { securityAuditService } from '../../services/securityAuditService.js';
import { performanceBenchmarkService } from '../../services/performanceBenchmarkService.js';
import { getIndexVerificationReport } from '../../services/databaseOptimizationService.js';
import { releaseReadinessService } from '../../services/releaseReadinessService.js';
import { enterpriseMetricsService } from '../../services/enterpriseMetricsService.js';

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (!(err instanceof Error)) {
    next(err);
    return;
  }
  if (err.message === 'INVALID_REQUEST') {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
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

  return router;
}

export default createReleaseReadinessRouter;

import { Router } from 'express';
import { securityCenterService } from '../../services/securityCenterService.js';
import { auditIntelligenceService } from '../../services/auditIntelligenceService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import type { Request, Response, NextFunction } from 'express';

export function createSecurityRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route GET /api/v1/security/dashboard
   * @desc Get security dashboard overview
   * @access Private (requires SECURITY_READ)
   */
  router.get(
    '/dashboard',
    requirePermission('SECURITY_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const dashboard = await securityCenterService.getSecurityDashboard(workspaceId);
        res.json(dashboard);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/security/events
   * @desc Get paginated security events with filtering
   * @access Private (requires SECURITY_READ)
   */
  router.get(
    '/events',
    requirePermission('SECURITY_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const filters: any = { workspaceId };
        const pagination: any = {};

        if (req.query.eventType) filters.eventType = req.query.eventType as string;
        if (req.query.severity) filters.severity = req.query.severity as string;
        if (req.query.status) filters.status = req.query.status as string;
        if (req.query.userId) filters.userId = req.query.userId as string;
        if (req.query.startDate) filters.startDate = req.query.startDate as string;
        if (req.query.endDate) filters.endDate = req.query.endDate as string;

        if (req.query.limit) pagination.limit = parseInt(req.query.limit as string, 10);
        if (req.query.offset) pagination.offset = parseInt(req.query.offset as string, 10);

        const result = await securityCenterService.getSecurityEvents(filters, pagination);
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/security/risk-score
   * @desc Get dynamic security risk score
   * @access Private (requires SECURITY_READ)
   */
  router.get(
    '/risk-score',
    requirePermission('SECURITY_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const riskScore = await securityCenterService.getRiskScore(workspaceId);
        res.json(riskScore);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/security/events/:id/resolve
   * @desc Resolve a security event
   * @access Private (requires SECURITY_MANAGE)
   */
  router.post(
    '/events/:id/resolve',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const eventId = id as string;
        const { resolutionNotes, status } = req.body;
        const { userId } = getAuthUser(req);

        const event = await securityCenterService.resolveSecurityEvent(
          eventId,
          resolutionNotes || '',
          status || 'RESOLVED',
          userId
        );

        if (!event) {
          return res.status(404).json({ error: 'Security event not found' });
        }

        res.json(event);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/security/threat-detection/run
   * @desc Trigger on-demand threat detection sweep
   * @access Private (requires SECURITY_MANAGE)
   */
  router.post(
    '/threat-detection/run',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        await securityCenterService.runThreatDetection(workspaceId);
        res.json({ message: 'Threat detection completed successfully' });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/security/intelligence
   * @desc Get security intelligence and anomaly detection
   * @access Private (requires SECURITY_READ)
   */
  router.get(
    '/intelligence',
    requirePermission('SECURITY_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const intelligence = await auditIntelligenceService.getSecurityIntelligence(workspaceId);
        res.json(intelligence);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/security/intelligence/scan
   * @desc Trigger on-demand security intelligence scan
   * @access Private (requires SECURITY_MANAGE)
   */
  router.post(
    '/intelligence/scan',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const intelligence = await auditIntelligenceService.scanWorkspace(workspaceId, userId);
        res.json(intelligence);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createSecurityRouter;

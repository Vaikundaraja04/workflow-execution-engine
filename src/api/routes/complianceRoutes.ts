import { Router } from 'express';
import { complianceReportService } from '../../services/complianceReportService.js';
import { retentionPolicyService } from '../../services/retentionPolicyService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import type { Request, Response, NextFunction } from 'express';

export function createComplianceRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route GET /api/v1/compliance/reports/soc2
   * @desc Generate SOC2 Type II compliance evidence report
   * @access Private (requires COMPLIANCE_EXPORT)
   */
  router.get(
    '/reports/soc2',
    requirePermission('COMPLIANCE_EXPORT'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const report = await complianceReportService.generateSoc2Report(workspaceId);
        await complianceReportService.logReportGeneration('SOC2', workspaceId, userId);
        res.json(report);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/compliance/reports/gdpr
   * @desc Generate GDPR compliance evidence report
   * @access Private (requires COMPLIANCE_EXPORT)
   */
  router.get(
    '/reports/gdpr',
    requirePermission('COMPLIANCE_EXPORT'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const report = await complianceReportService.generateGdprReport(workspaceId);
        await complianceReportService.logReportGeneration('GDPR', workspaceId, userId);
        res.json(report);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/compliance/reports/iso27001
   * @desc Generate ISO27001 compliance evidence report
   * @access Private (requires COMPLIANCE_EXPORT)
   */
  router.get(
    '/reports/iso27001',
    requirePermission('COMPLIANCE_EXPORT'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const report = await complianceReportService.generateIso27001Report(workspaceId);
        await complianceReportService.logReportGeneration('ISO27001', workspaceId, userId);
        res.json(report);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/compliance/retention-policies
   * @desc List workspace retention policies
   * @access Private (requires COMPLIANCE_EXPORT)
   */
  router.get(
    '/retention-policies',
    requirePermission('COMPLIANCE_EXPORT'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const policies = await retentionPolicyService.listRetentionPolicies(workspaceId);
        res.json(policies);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route PUT /api/v1/compliance/retention-policies
   * @desc Set or update retention policy
   * @access Private (requires SECURITY_MANAGE)
   */
  router.put(
    '/retention-policies',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const { resourceType, retentionDays } = req.body;

        if (!workspaceId || !resourceType || retentionDays === undefined) {
          return res.status(400).json({ error: 'Missing required parameters' });
        }

        const policy = await retentionPolicyService.setRetentionPolicy(
          workspaceId,
          resourceType,
          retentionDays,
          userId
        );
        res.json(policy);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route DELETE /api/v1/compliance/retention-policies/:resourceType
   * @desc Delete retention policy
   * @access Private (requires SECURITY_MANAGE)
   */
  router.delete(
    '/retention-policies/:resourceType',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const resourceType = req.params.resourceType as string;

        if (!workspaceId || !resourceType) {
          return res.status(400).json({ error: 'Missing required parameters' });
        }

        const deleted = await retentionPolicyService.deleteRetentionPolicy(
          workspaceId,
          resourceType,
          userId
        );
        res.json({ success: deleted });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route POST /api/v1/compliance/retention-policies/:resourceType/apply
   * @desc Trigger manual enforcement of a retention policy
   * @access Private (requires SECURITY_MANAGE)
   */
  router.post(
    '/retention-policies/:resourceType/apply',
    requirePermission('SECURITY_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const resourceType = req.params.resourceType as string;

        if (!workspaceId || !resourceType) {
          return res.status(400).json({ error: 'Missing required parameters' });
        }

        const result = await retentionPolicyService.applyRetentionPolicy(workspaceId, resourceType);
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export default createComplianceRouter;
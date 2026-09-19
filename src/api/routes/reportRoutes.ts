import { Router } from 'express';
import ReportService, { type CreateReportInput } from '../../services/reportService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import type { Request, Response, NextFunction } from 'express';

export function createReportRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * @route POST /api/v1/reports
   * @desc Generate a new report (on-demand or scheduled)
   * @access Private (requires AUDIT_READ)
   */
  router.post(
    '/',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const input: CreateReportInput = req.body;

        if (!input.name || !input.type) {
          return res.status(400).json({ error: 'Report name and type are required' });
        }

        const report = await ReportService.createReport(workspaceId, userId, input);
        res.status(201).json(report);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/reports
   * @desc List generated reports in workspace
   * @access Private (requires AUDIT_READ)
   */
  router.get(
    '/',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const filters = {
          type: req.query.type as string,
          status: req.query.status as string,
        };

        const reports = await ReportService.getReports(workspaceId, filters);
        res.json({ reports, total: reports.length });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/reports/:id
   * @desc Get a single report by ID
   * @access Private (requires AUDIT_READ)
   */
  router.get(
    '/:id',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { id } = req.params;

        const report = await ReportService.getReportById(id as string, workspaceId);
        if (!report) {
          return res.status(404).json({ error: 'Report not found' });
        }

        res.json(report);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route DELETE /api/v1/reports/:id
   * @desc Delete a generated report
   * @access Private (requires AUDIT_READ)
   */
  router.delete(
    '/:id',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { userId } = getAuthUser(req);
        const { id } = req.params;

        const deleted = await ReportService.deleteReport(id as string, workspaceId, userId);
        if (!deleted) {
          return res.status(404).json({ error: 'Report not found' });
        }

        res.json({ message: 'Report deleted successfully' });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * @route GET /api/v1/reports/:id/export
   * @desc Download or export report payload in JSON, CSV, or PDF format
   * @access Private (requires AUDIT_READ)
   */
  router.get(
    '/:id/export',
    requirePermission('AUDIT_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const { id } = req.params;
        const formatOverride = req.query.format as any;

        const exported = await ReportService.exportReport(id as string, workspaceId, formatOverride);

        res.setHeader('Content-Type', exported.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
        res.send(exported.data);
      } catch (error) {
        if ((error as Error).message === 'REPORT_NOT_FOUND') {
          return res.status(404).json({ error: 'Report not found' });
        }
        next(error);
      }
    }
  );

  return router;
}

export default createReportRouter;

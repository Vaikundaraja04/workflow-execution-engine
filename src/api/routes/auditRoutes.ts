import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { AUDIT_ACTIONS } from '../../models/AuditLogModel.js';
import type { AuditAction } from '../../models/AuditLogModel.js';
import {
  queryAuditLogs,
  getAuditLogById,
  getAuditActions,
  getAuditSummary,
} from '../../services/auditQueryService.js';
import type { AuditFilter, AuditQueryOptions } from '../../services/auditQueryService.js';
import { auditExportService } from '../../services/auditExportService.js';
import { verifyAuditChain } from '../../services/auditService.js';

const auditFilterQuerySchema = z.object({
  userId: z.string().trim().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  resource: z.string().trim().optional(),
  resourceId: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  ipAddress: z.string().trim().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).optional(),
  sortBy: z.enum(['createdAt', 'action', 'resource']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

function getRouteLogId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('INVALID_AUDIT_LOG_ID');
  return id;
}

export function createAuditRouter(): Router {
  const router = Router({ mergeParams: true });
  const requireAuditRead = requirePermission('AUDIT_READ', { workspaceParam: 'workspaceId' });

  // GET /actions - Get available audit actions
  router.get('/actions', requireAuditRead, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const actions = getAuditActions();
      res.json({ actions });
    } catch (error) {
      next(error);
    }
  });

  // GET /summary - Get summary metrics of audit events
  router.get('/summary', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const days = req.query.days ? Number(req.query.days) : 30;
      const summary = await getAuditSummary(workspaceId, Number.isFinite(days) && days > 0 ? days : 30);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  // Handler for querying audit logs
  const handleQueryLogs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = auditFilterQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid query parameters',
          },
        });
      }

      const workspaceId = getWorkspaceContext(req).workspaceId;
      const query = parsed.data;

      const startDate = query.startDate ?? query.from;
      const endDate = query.endDate ?? query.to;

      const offset = query.page !== undefined
        ? (query.page - 1) * query.limit
        : query.offset;

      const result = await queryAuditLogs(
        workspaceId,
        {
          userId: query.userId,
          action: query.action as AuditAction | undefined,
          resource: query.resource,
          resourceId: query.resourceId,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          ipAddress: query.ipAddress,
          search: query.search,
        } as AuditFilter,
        {
          limit: query.limit,
          offset,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
        } as AuditQueryOptions,
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // Handler for getting a single audit log
  const handleGetLogById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logId = getRouteLogId(req);
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const log = await getAuditLogById(logId, workspaceId);

      if (!log) {
        return res.status(404).json({
          error: {
            code: 'AUDIT_LOG_NOT_FOUND',
            message: 'Audit log was not found',
          },
        });
      }

      res.json(log);
    } catch (error) {
      next(error);
    }
  };

  // GET / and /logs - Query audit logs
  router.get('/', requireAuditRead, handleQueryLogs);
  router.get('/logs', requireAuditRead, handleQueryLogs);

  // GET /export - Export audit logs in CSV or JSON format
  router.get('/export', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const query = auditFilterQuerySchema.parse(req.query);

      const startDate = query.startDate ?? query.from;
      const endDate = query.endDate ?? query.to;

      const offset = query.page !== undefined
        ? (query.page - 1) * query.limit
        : query.offset;

      const result = await queryAuditLogs(
        workspaceId,
        {
          userId: query.userId,
          action: query.action as AuditAction | undefined,
          resource: query.resource,
          resourceId: query.resourceId,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          ipAddress: query.ipAddress,
          search: query.search,
        } as AuditFilter,
        {
          limit: query.limit,
          offset,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
        } as AuditQueryOptions,
      );

      // Export as CSV or JSON based on query parameter
      const format = (req.query.format as 'CSV' | 'JSON')?.toUpperCase() === 'CSV' ? 'CSV' : 'JSON';
      const exportResult = await auditExportService.exportAuditLogs(
        {
          workspaceId,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          actionTypes: query.action ? [query.action] : undefined,
          userId: query.userId,
          format,
        },
        getAuthUser(req).userId
      );

      res.set({
        'Content-Type': exportResult.mimeType,
        'Content-Disposition': `attachment; filename="${exportResult.filename}"`,
      });
      res.send(exportResult.data);
    } catch (error) {
      next(error);
    }
  });

  // GET /verify-chain - Verify audit log hash chain integrity
  router.get('/verify-chain', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = getWorkspaceContext(req).workspaceId;
      const verificationResult = await verifyAuditChain(workspaceId ? new Types.ObjectId(workspaceId) : undefined);
      res.json(verificationResult);
    } catch (error) {
      next(error);
    }
  });

  // GET /logs/:id and /:id - Get specific audit log
  router.get('/logs/:id', requireAuditRead, handleGetLogById);
  router.get('/:id', requireAuditRead, handleGetLogById);

  return router;
}

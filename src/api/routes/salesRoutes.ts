import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthConfig } from '../../auth/jwt.service.js';
import { z } from 'zod';
import { leadService } from '../../services/leadService.js';
import { leadExportService, LEAD_EXPORT_FORMATS } from '../../services/leadExportService.js';
import { conversionTrackingService } from '../../services/conversionTrackingService.js';
import { demoWorkspaceService } from '../../services/demoWorkspaceService.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { LEAD_STATUSES, LEAD_DEMO_STATUSES, LEAD_SOURCES, LEAD_INTERESTS } from '../../models/LeadModel.js';

const requestContext = (req: Request) => ({ ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined });
const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });
const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  demoStatus: z.enum(LEAD_DEMO_STATUSES).optional(),
  assignedTo: z.string().nullable().optional(),
  industry: z.string().trim().max(80).optional(),
  companySize: z.string().nullable().optional(),
  interest: z.enum(LEAD_INTERESTS).nullable().optional(),
  estimatedValueMonthly: z.number().nullable().optional(),
  lostReason: z.string().trim().max(500).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  note: z.string().trim().max(2000).optional(),
  markContacted: z.boolean().optional(),
  demoWorkspaceId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
}).strict();

const funnelQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  source: z.string().trim().max(64).optional(),
});

const listFiltersSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  demoStatus: z.enum(LEAD_DEMO_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  search: z.string().trim().max(160).optional(),
  assigned: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});


const exportQuerySchema = z.object({
  format: z.enum(LEAD_EXPORT_FORMATS).default('csv'),
  status: z.enum(LEAD_STATUSES).optional(),
  demoStatus: z.enum(LEAD_DEMO_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});
export function createSalesRouter(config: AuthConfig, requireAuth: RequestHandler): Router {
  const router = Router();
  const admin = [requireAuth, requirePlatformAdmin()] as RequestHandler[];

  router.get('/leads', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = listFiltersSchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json(badRequest('Invalid query parameters'));
      const { assigned: _assigned, ...filters } = parsed.data;
      res.json(await leadService.list(filters));
    } catch (error) { next(error); }
  });

  router.get('/leads/pipeline', admin, async (_req: Request, res: Response, next: NextFunction) => {
    try { res.json(await leadService.pipeline()); } catch (error) { next(error); }
  });

  router.get('/leads/export', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = exportQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json(badRequest('Invalid query parameters'));
      const { format, limit, ...filters } = parsed.data;
      const result = await leadExportService.export({
        format,
        limit,
        filters,
        actorUserId: getAuthUser(req).userId,
      });
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename + '"');
      res.setHeader('X-Export-Row-Count', String(result.rowCount));
      if (result.format === 'csv') {
        res.send(result.csv ?? '' );
        return;
      }
      res.json({ leads: result.leads ?? [], rowCount: result.rowCount, generatedAt: result.generatedAt });
    } catch (error) { next(error); }
  });
  router.get('/leads/:leadId', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.params.leadId) return res.status(400).json({ error: { code: 'INVALID_LEAD_ID', message: 'Invalid lead ID' } });
      res.json(await leadService.get(req.params.leadId as string));
    } catch (error) { next(error); }
  });

  router.patch('/leads/:leadId', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateLeadSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const actorUserId = getAuthUser(req).userId;
      const updated = await leadService.update(req.params.leadId as string, parsed.data, actorUserId, requestContext(req));
      res.json(updated);
    } catch (error) { next(error); }
  });

  router.post('/leads/:leadId/demo', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const leadId = req.params.leadId as string;
      if (!leadId) return res.status(400).json({ error: { code: 'INVALID_LEAD_ID', message: 'Invalid lead ID' } });
      const parsed = z.object({ ttlHours: z.coerce.number().int().min(1).max(168).optional() }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const demo = await demoWorkspaceService.create(config, {
        ttlHours: parsed.data.ttlHours, ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined,
      });
      const actorUserId = getAuthUser(req).userId;
      const updated = await leadService.attachDemo(leadId, {
        demoWorkspaceId: demo.workspaceId, demoExpiresAt: demo.demoExpiresAt, demoStatus: 'CREATED',
      }, actorUserId);
      await conversionTrackingService.record({ event: 'DEMO_CREATED', source: 'LEAD', workspaceId: demo.workspaceId, leadId });
      res.status(201).json({ lead: updated, demo });
    } catch (error) { next(error); }
  });

  router.get('/funnel', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = funnelQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json(badRequest('Invalid query parameters'));
      res.json(await conversionTrackingService.funnel(parsed.data));
    } catch (error) { next(error); }
  });

  return router;
}

import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { partnerService } from '../../services/partnerService.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { getAuthUser } from '../../auth/auth.middleware.js';

/**
 * Phase 16.6 - Partner channel API. Platform administrators only: partners are
 * commercial records and the revenue report spans customers.
 */

const createPartnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(160),
  contactName: z.string().trim().min(1).max(160),
  contactEmail: z.string().trim().toLowerCase().email().max(254),
  code: z.string().trim().min(2).max(32).optional(),
  tier: z.enum(['BRONZE', 'SILVER', 'GOLD'] as const).optional(),
  commissionRatePercent: z.coerce.number().min(0).max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

const referralSchema = z.object({
  code: z.string().trim().min(2).max(32),
  leadId: z.string().trim().min(1).optional(),
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });

export function createPartnerRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const admin = [requireAuth, requirePlatformAdmin()] as RequestHandler[];

  router.post('/', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createPartnerSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const partner = await partnerService.createPartner(parsed.data, getAuthUser(req).userId);
      res.status(201).json({ partner });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
      if (status && status !== 'ACTIVE' && status !== 'SUSPENDED') {
        return res.status(400).json(badRequest('Invalid status filter'));
      }
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      res.json({ partners: await partnerService.listPartners({
        ...(status ? { status: status as 'ACTIVE' | 'SUSPENDED' } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/revenue', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      res.json(await partnerService.revenueReport({ limit }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/referrals', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = referralSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const partner = await partnerService.registerReferral({
        code: parsed.data.code,
        leadId: parsed.data.leadId ?? null,
        workspaceId: parsed.data.workspaceId ?? null,
      }, getAuthUser(req).userId);
      res.status(201).json({ partner });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

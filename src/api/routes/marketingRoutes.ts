import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { productPackagingService } from '../../services/productPackagingService.js';
import { leadService } from '../../services/leadService.js';
import { conversionTrackingService } from '../../services/conversionTrackingService.js';
import { COMPANY_SIZES, LEAD_INTERESTS } from '../../models/LeadModel.js';

/**
 * Phase 14 - Public go-to-market endpoints.
 *
 * These routes back the marketing site: the sellable package catalog, plan
 * comparison, lead capture and the first funnel steps. They are unauthenticated
 * by design and therefore rate limited by the caller (createSignupRateLimiter)
 * and limited to coarse, non-sensitive data.
 */

const PUBLIC_LEAD_SOURCES = ['WEBSITE', 'PRICING_PAGE', 'DEMO_REQUEST', 'REFERRAL', 'OTHER'] as const;
const PUBLIC_FUNNEL_EVENTS = ['LANDING_VIEW', 'SIGNUP_STARTED'] as const;

const leadCaptureSchema = z.object({
  company: z.string().trim().min(1).max(160),
  contactName: z.string().trim().min(1).max(160),
  contactEmail: z.string().trim().toLowerCase().email().max(254),
  contactPhone: z.string().trim().max(40).optional(),
  industry: z.string().trim().max(80).optional(),
  companySize: z.enum(COMPANY_SIZES).optional(),
  interest: z.enum(LEAD_INTERESTS).optional(),
  message: z.string().trim().max(2000).optional(),
  source: z.enum(PUBLIC_LEAD_SOURCES).optional(),
  utm: z.record(z.string().max(40), z.string().max(200)).optional(),
}).strict();

const funnelEventSchema = z.object({
  event: z.enum(PUBLIC_FUNNEL_EVENTS),
  anonymousId: z.string().trim().max(128).optional(),
  source: z.string().trim().max(64).optional(),
  utm: z.record(z.string().max(40), z.string().max(200)).optional(),
}).strict();

function requestContext(req: Request): { ipAddress?: string | undefined; userAgent?: string | undefined } {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

export function createMarketingRouter(publicLimiter?: RequestHandler): Router {
  const router = Router();

  // Sellable package catalog (Starter / Business / Enterprise) plus the free tier.
  router.get('/plans', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const plans = await productPackagingService.listProductPlans();
      res.json({
        plans,
        freeTier: productPackagingService.getFreeTierSummary(),
        aliases: { BUSINESS: 'PROFESSIONAL' },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/plans/compare', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      if (!from || !to) {
        return res.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'from and to package ids are required' },
        });
      }
      const comparison = await productPackagingService.compareProductPlans(from, to);
      res.json(comparison);
    } catch (error) {
      next(error);
    }
  });

  // Inbound lead capture from the website, pricing page and demo request forms.
  router.post(
    '/leads',
    ...(publicLimiter ? [publicLimiter] : []),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = leadCaptureSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const result = await leadService.capture({
          ...parsed.data,
          source: parsed.data.source ?? 'WEBSITE',
          ...requestContext(req),
        });
        res.status(201).json({ lead: result.lead, duplicate: result.duplicateOf !== null });
      } catch (error) {
        next(error);
      }
    },
  );

  // First funnel steps (landing view / signup started). Analytics only - the
  // signup and billing flows record their own completion events server-side.
  router.post(
    '/events',
    ...(publicLimiter ? [publicLimiter] : []),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = funnelEventSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const result = await conversionTrackingService.recordSafely({
          event: parsed.data.event,
          source: parsed.data.source ?? null,
          anonymousId: parsed.data.anonymousId ?? null,
          utm: parsed.data.utm,
        });
        res.status(202).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

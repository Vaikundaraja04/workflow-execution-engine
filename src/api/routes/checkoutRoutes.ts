import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { checkoutService } from '../../services/checkoutService.js';
import { createBillingProvider } from '../../services/billing/billingProviderRegistry.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { requireActiveTenant } from '../middleware/requireEntitlement.js';
import { getAuthUser } from '../../auth/auth.middleware.js';

/**
 * Phase 15.3 - Checkout flow.
 *
 * Plan selection -> provider session -> payment verification -> subscription
 * activation. Entitlements are derived from the subscription, so activation is
 * the entitlement update and the verification response carries the evaluated
 * summary for the client.
 */

const checkoutSessionSchema = z.object({
  packageId: z.string().trim().min(1),
  provider: z.enum(['mock', 'stripe', 'razorpay']).optional(),
  currency: z.string().length(3).optional(),
}).strict();

const verifySchema = z.object({
  paymentId: z.string().trim().min(1),
  packageId: z.string().trim().min(1).optional(),
}).strict();

const invoiceSchema = z.object({
  customerId: z.string().trim().min(1),
  description: z.string().trim().max(200).optional(),
  amount: z.coerce.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  daysUntilDue: z.coerce.number().int().min(1).optional(),
  provider: z.enum(['mock', 'stripe', 'razorpay']).optional(),
  metadata: z.record(z.string().trim().max(40), z.string().trim().max(200)).optional(),
}).strict();

const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });
const requestContext = (req: Request) => ({ ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined });

export function createCheckoutRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const customerGuard = [requireAuth, requireActiveTenant(), requireMembership()] as RequestHandler[];

  router.post('/checkout', customerGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = checkoutSessionSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const { workspaceId } = getWorkspaceContext(req);
      const session = await checkoutService.createSession({
        workspaceId,
        packageId: parsed.data.packageId,
        userId: getAuthUser(req).userId,
        provider: parsed.data.provider,
        currency: parsed.data.currency,
        context: requestContext(req),
      });
      res.status(201).json({ session });
    } catch (error) {
      next(error);
    }
  });

  router.post('/checkout/verify', customerGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = verifySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const { workspaceId } = getWorkspaceContext(req);
      const result = await checkoutService.verifyAndActivate({
        workspaceId,
        paymentId: parsed.data.paymentId,
        packageId: parsed.data.packageId,
        userId: getAuthUser(req).userId,
        context: requestContext(req),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/payments', customerGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = getWorkspaceContext(req);
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const payments = await checkoutService.listPayments(workspaceId, limit);
      res.json({ payments });
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices', requireAuth, requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = invoiceSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const provider = createBillingProvider(parsed.data.provider);
      const invoice = await provider.createInvoice({
        customerId: parsed.data.customerId,
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
        ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
        ...(parsed.data.daysUntilDue !== undefined ? { daysUntilDue: parsed.data.daysUntilDue } : {}),
        ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
      });
      res.status(201).json({ invoice });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

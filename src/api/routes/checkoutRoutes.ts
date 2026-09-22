import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { billingService } from '../../services/billingService.js';
import { createBillingProvider, isBillingProviderName } from '../../services/billing/billingProviderRegistry.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { requireActiveTenant } from '../middleware/requireEntitlement.js';

const verifySchema = z.object({ paymentId: z.string().trim().min(1) });
const invoiceSchema = z.object({
  customerId: z.string().trim().min(1),
  description: z.string().trim().max(200).optional(),
  amount: z.coerce.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  daysUntilDue: z.coerce.number().int().min(1).optional(),
  provider: z.enum(['mock', 'stripe', 'razorpay']).optional(),
  metadata: z.record(z.string().trim().max(40), z.string().trim().max(200)).optional(),
}).strict();

export function createCheckoutRouter(requireAuth: RequestHandler): Router {
  const router = Router();

  router.post('/checkout/verify',
    requireAuth, requireActiveTenant(), requireMembership(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = verifySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const { workspaceId } = getWorkspaceContext(req);
        const subscription = await billingService.getSubscription(workspaceId);
        if (!subscription || !subscription.billingProvider) {
          return res.status(404).json({ error: { code: 'SUBSCRIPTION_NOT_FOUND', message: 'No billing provider on file for this workspace' } });
        }
        const provider = createBillingProvider(
          isBillingProviderName(subscription.billingProvider) ? subscription.billingProvider : undefined,
        );
        const payment = await provider.verifyPayment({ paymentId: parsed.data.paymentId });
        res.json({ payment });
      } catch (error) {
        next(error);
      }
    });

  router.post('/invoices',
    requireAuth, requirePlatformAdmin(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = invoiceSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
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

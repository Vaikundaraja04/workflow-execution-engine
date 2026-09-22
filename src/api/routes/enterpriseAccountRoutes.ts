import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { accountManagementService } from '../../services/accountManagementService.js';
import { CONTRACT_TYPES, ENTERPRISE_CUSTOMER_STATUSES } from '../../models/EnterpriseAccountModel.js';

/**
 * Phase 18.1 - Enterprise accounts API.
 *
 * The account register spans tenants, so every route is platform-administrator
 * only; a workspace member never sees another account.
 */

const createAccountSchema = z.object({
  workspaceId: z.string().trim().min(1),
  company: z.string().trim().min(1).max(160),
  industry: z.string().trim().min(1).max(80).optional(),
  accountOwnerId: z.string().trim().min(1),
  contractType: z.enum(CONTRACT_TYPES).optional(),
  subscriptionPlan: z.string().trim().min(1).max(40).nullable().optional(),
  renewalDate: z.string().trim().min(1).nullable().optional(),
  customerStatus: z.enum(ENTERPRISE_CUSTOMER_STATUSES).optional(),
  mrr: z.coerce.number().int().nonnegative().nullable().optional(),
  seats: z.coerce.number().int().nonnegative().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();

const updateAccountSchema = z.object({
  customerStatus: z.enum(ENTERPRISE_CUSTOMER_STATUSES).optional(),
  contractType: z.enum(CONTRACT_TYPES).optional(),
  subscriptionPlan: z.string().trim().min(1).max(40).nullable().optional(),
  renewalDate: z.string().trim().min(1).nullable().optional(),
  accountOwnerId: z.string().trim().min(1).optional(),
  industry: z.string().trim().min(1).max(80).optional(),
  mrr: z.coerce.number().int().nonnegative().nullable().optional(),
  seats: z.coerce.number().int().nonnegative().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();

const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });

function numberQuery(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
export function createEnterpriseAccountRouter(): Router {
  const router = Router();
  const admin = requirePlatformAdmin();

  router.post('/', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createAccountSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const account = await accountManagementService.createAccount(parsed.data, getAuthUser(req).userId);
      res.status(201).json({ data: account });
    } catch (err) { next(err); }
  });

  router.get('/', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerStatus = oneOf(req.query.customerStatus, ENTERPRISE_CUSTOMER_STATUSES);
      const renewalWithinDays = numberQuery(req.query.renewalWithinDays);
      const page = numberQuery(req.query.page);
      const limit = numberQuery(req.query.limit);
      const result = await accountManagementService.listAccounts({
        ...(customerStatus !== undefined ? { customerStatus } : {}),
        ...(typeof req.query.industry === 'string' ? { industry: req.query.industry } : {}),
        ...(typeof req.query.accountOwnerId === 'string' ? { accountOwnerId: req.query.accountOwnerId } : {}),
        ...(typeof req.query.q === 'string' ? { q: req.query.q } : {}),
        ...(renewalWithinDays !== undefined ? { renewalWithinDays } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      res.json({ data: result });
    } catch (err) { next(err); }
  });
  router.get('/:id', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const account = await accountManagementService.getAccount(req.params.id as string);
      res.json({ data: account });
    } catch (err) { next(err); }
  });

  router.patch('/:id', admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateAccountSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const account = await accountManagementService.updateAccount(
        req.params.id as string,
        parsed.data,
        getAuthUser(req).userId,
      );
      res.json({ data: account });
    } catch (err) { next(err); }
  });

  return router;
}
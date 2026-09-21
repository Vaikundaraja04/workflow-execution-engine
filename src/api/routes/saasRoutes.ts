import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { AuthConfig } from '../../auth/jwt.service.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { requireActiveTenant } from '../middleware/requireEntitlement.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { saasOnboardingService } from '../../services/saasOnboardingService.js';
import { customerManagementService } from '../../services/customerManagementService.js';
import type { TenantStatus } from '../../models/TenantAccountModel.js';
import type { SubscriptionPlan } from '../../models/SubscriptionModel.js';

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(160),
  companyName: z.string().trim().min(1).max(160),
  workspaceName: z.string().trim().min(1).max(120).optional(),
  useCase: z.string().trim().max(280).optional(),
  plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  trialDays: z.number().int().min(1).max(90).optional(),
}).strict();

const onboardingSchema = z.object({
  steps: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  completed: z.boolean().optional(),
}).strict();

const noteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
}).strict();
const TENANT_STATUSES = ['TRIALING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
const PLANS = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;

function requestContext(req: Request): { ipAddress?: string | undefined; userAgent?: string | undefined } {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

function parseListFilters(req: Request) {
  const status = typeof req.query.status === 'string' && (TENANT_STATUSES as readonly string[]).includes(req.query.status)
    ? (req.query.status as TenantStatus)
    : undefined;
  const plan = typeof req.query.plan === 'string' && (PLANS as readonly string[]).includes(req.query.plan)
    ? (req.query.plan as SubscriptionPlan)
    : undefined;
  const demo = req.query.demo === 'true' ? true : req.query.demo === 'false' ? false : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;
  return {
    ...(status ? { status } : {}),
    ...(plan ? { plan } : {}),
    ...(demo !== undefined ? { demo } : {}),
    ...(search ? { search } : {}),
    ...(Number.isFinite(limit) ? { limit } : {}),
    ...(Number.isFinite(offset) ? { offset } : {}),
  };
}
export function createSaasRouter(
  config: AuthConfig,
  requireAuth: RequestHandler,
  signupLimiter?: RequestHandler,
): Router {
  const router = Router();

  router.post(
    '/signup',
    ...(signupLimiter ? [signupLimiter] : []),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = signupSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const result = await saasOnboardingService.signup(
          { ...parsed.data, ...requestContext(req) },
          config,
        );
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/onboarding',
    requireAuth,
    requireActiveTenant(),
    requireMembership(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = onboardingSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const { workspaceId } = getWorkspaceContext(req);
        const userId = getAuthUser(req).userId;
        const result = await saasOnboardingService.recordOnboarding(workspaceId, userId, parsed.data);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/account',
    requireAuth,
    requireActiveTenant(),
    requireMembership(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = getWorkspaceContext(req);
        const account = await saasOnboardingService.getAccount(workspaceId);
        res.json(account);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/customers',
    requireAuth,
    requirePlatformAdmin(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await customerManagementService.listCustomers(parseListFilters(req));
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/customers/:workspaceId',
    requireAuth,
    requirePlatformAdmin(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await customerManagementService.getCustomerDetail(req.params.workspaceId as string);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/customers/:workspaceId/suspend',
    requireAuth,
    requirePlatformAdmin(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actorUserId = getAuthUser(req).userId;
        const result = await customerManagementService.suspend(
          req.params.workspaceId as string,
          actorUserId,
          requestContext(req),
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/customers/:workspaceId/reactivate',
    requireAuth,
    requirePlatformAdmin(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actorUserId = getAuthUser(req).userId;
        const result = await customerManagementService.reactivate(
          req.params.workspaceId as string,
          actorUserId,
          requestContext(req),
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/customers/:workspaceId/notes',
    requireAuth,
    requirePlatformAdmin(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = noteSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const actorUserId = getAuthUser(req).userId;
        const result = await customerManagementService.addNote(
          req.params.workspaceId as string,
          actorUserId,
          parsed.data.note,
          requestContext(req),
        );
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

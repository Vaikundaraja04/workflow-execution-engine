import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  createIdentityProvider,
  deleteIdentityProvider,
  discoverProviders,
  getIdentityProvider,
  listIdentityProviders,
  startSSOLogin,
  handleSSOCallback,
  updateIdentityProvider,
} from '../../services/ssoService.js';
import {
  createSCIMToken,
  listSCIMTokens,
  revokeSCIMToken,
} from '../../services/scimService.js';
import type { AuthConfig } from '../../auth/jwt.service.js';

const domainSchema = z.string().trim().toLowerCase().max(253);

const createProviderSchema = z.object({
  type: z.enum(['OIDC', 'SAML']),
  name: z.string().trim().min(1).max(120),
  issuer: z.string().trim().min(1).max(2048),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(512),
  authorizationEndpoint: z.string().trim().max(2048).optional(),
  tokenEndpoint: z.string().trim().max(2048).optional(),
  userinfoEndpoint: z.string().trim().max(2048).optional(),
  jwksUri: z.string().trim().max(2048).optional(),
  scopes: z.array(z.string().min(1)).optional(),
  domains: z.array(domainSchema).optional(),
  domainVerificationStatus: z.enum(['VERIFIED', 'PENDING']).optional(),
  enforceSSO: z.boolean().optional(),
  allowPasswordFallback: z.boolean().optional(),
  roleMapping: z.record(z.string(), z.string()).optional(),
}).strict();

const updateProviderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  issuer: z.string().trim().min(1).max(2048).optional(),
  clientId: z.string().trim().min(1).max(512).optional(),
  clientSecret: z.string().min(1).max(512).optional(),
  authorizationEndpoint: z.string().trim().max(2048).optional(),
  tokenEndpoint: z.string().trim().max(2048).optional(),
  userinfoEndpoint: z.string().trim().max(2048).optional(),
  jwksUri: z.string().trim().max(2048).optional(),
  scopes: z.array(z.string().min(1)).optional(),
  domains: z.array(domainSchema).optional(),
  domainVerificationStatus: z.enum(['VERIFIED', 'PENDING']).optional(),
  enforceSSO: z.boolean().optional(),
  allowPasswordFallback: z.boolean().optional(),
  roleMapping: z.record(z.string(), z.string()).optional(),
}).strict();

const createSCIMTokenSchema = z.object({
  description: z.string().trim().max(256).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
}).strict();

function getRouteWorkspaceId(req: Request): string {
  const id = req.params.workspaceId ?? req.params.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('INVALID_WORKSPACE_ID');
  return id;
}

function getRouteProviderId(req: Request): string {
  const id = req.params.providerId;
  if (typeof id !== 'string' || id.length === 0) throw new Error('INVALID_PROVIDER_ID');
  return id;
}

function sendInvalidRequest(res: Response): void {
  res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
}

/**
 * Public SSO auth routes:
 * GET /api/auth/sso/providers
 * POST /api/auth/sso/:providerId/start
 * GET /api/auth/sso/:providerId/callback
 */
export function createSSOAuthRouter(authConfig?: AuthConfig): Router {
  const router = Router({ mergeParams: true });
  const defaultAuthConfig: AuthConfig = authConfig ?? {
    jwtSecret: process.env.AUTH_JWT_SECRET || 'test-jwt-secret-0123456789abcdef',
    accessTtl: process.env.AUTH_ACCESS_TTL || '15m',
    refreshTtl: process.env.AUTH_REFRESH_TTL || '30d',
  };

  router.get('/providers', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.query.email === 'string' ? req.query.email : undefined;
      const domain = typeof req.query.domain === 'string' ? req.query.domain : undefined;
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

      const providers = await discoverProviders({ email, domain, workspaceId });
      res.json(providers);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.post('/:providerId/start', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = getRouteProviderId(req);
      const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;

      const result = await startSSOLogin(providerId, redirectUri);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.get('/:providerId/callback', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = getRouteProviderId(req);
      const code = typeof req.query.code === 'string' ? req.query.code : undefined;
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;

      if (!code || !state) {
        res.status(400).json({ error: { code: 'SSO_CALLBACK_INVALID', message: 'Missing code or state parameter' } });
        return;
      }

      const sessionContext = {
        ipAddress: req.ip ?? req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim(),
        userAgent: req.headers['user-agent'],
      };

      const result = await handleSSOCallback(providerId, code, state, defaultAuthConfig, sessionContext);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  return router;
}

export const createSsoRouter = createSSOAuthRouter;

/**
 * Workspace admin routes for Identity Provider and SCIM token management.
 */
export function createSSOAdminRouter(): Router {
  const router = Router({ mergeParams: true });
  const requireMemberManage = requirePermission('MEMBER_MANAGE', { workspaceParam: 'workspaceId' });

  // List IdPs for workspace
  router.get(
    '/identity-providers',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const providers = await listIdentityProviders(workspaceId);
        res.json(providers);
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  // Get single IdP
  router.get(
    '/identity-providers/:providerId',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const providerId = getRouteProviderId(req);
        const provider = await getIdentityProvider(workspaceId, providerId);
        res.json(provider);
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  // Create IdP
  router.post(
    '/identity-providers',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const userId = getAuthUser(req).userId;
        const parsed = createProviderSchema.safeParse(req.body);
        if (!parsed.success) {
          sendInvalidRequest(res);
          return;
        }

        const provider = await createIdentityProvider(workspaceId, userId, parsed.data);
        res.status(201).json(provider);
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  // Update IdP
  router.patch(
    '/identity-providers/:providerId',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const providerId = getRouteProviderId(req);
        const userId = getAuthUser(req).userId;
        const parsed = updateProviderSchema.safeParse(req.body);
        if (!parsed.success) {
          sendInvalidRequest(res);
          return;
        }

        const provider = await updateIdentityProvider(workspaceId, providerId, userId, parsed.data);
        res.json(provider);
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  // Delete/Disable IdP
  router.delete(
    '/identity-providers/:providerId',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const providerId = getRouteProviderId(req);
        const userId = getAuthUser(req).userId;

        await deleteIdentityProvider(workspaceId, providerId, userId);
        res.json({ message: 'Identity provider disabled successfully' });
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  // === SCIM Token Management ===

  // Generate SCIM Token
  router.post(
    '/scim-tokens',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const userId = getAuthUser(req).userId;
        const parsed = createSCIMTokenSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          sendInvalidRequest(res);
          return;
        }

        const result = await createSCIMToken(
          workspaceId,
          userId,
          parsed.data.description,
          parsed.data.expiresInDays,
        );

        res.status(201).json({
          token: result.token,
          prefix: result.scimToken.prefix,
          expiresAt: result.scimToken.expiresAt,
        });
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  // List SCIM Tokens
  router.get(
    '/scim-tokens',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const tokens = await listSCIMTokens(workspaceId);
        res.json(tokens);
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  // Revoke SCIM Token
  router.delete(
    '/scim-tokens/:tokenId',
    requireMemberManage,
    (async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getRouteWorkspaceId(req);
        const tokenId = req.params.tokenId as string;
        const userId = getAuthUser(req).userId;

        await revokeSCIMToken(tokenId, workspaceId, userId);
        res.json({ message: 'SCIM token revoked successfully' });
      } catch (error) {
        next(error);
      }
    }) as RequestHandler
  );

  return router;
}

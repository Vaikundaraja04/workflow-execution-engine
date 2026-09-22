import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { AuthConfig } from './jwt.service.js';
import type { IUser } from '../models/UserModel.js';
import { createAuditLog } from '../services/auditService.js';
import {
  issueTokens,
  listUserSessions,
  loginUser,
  registerUser,
  revokeAllUserSessions,
  revokeRefreshTokenFamily,
  revokeSessionFamily,
  rotateRefreshToken,
  toUserView,
} from './auth.service.js';
import type { SessionContext } from './auth.service.js';
import { getAuthUser } from './auth.middleware.js';
import { ensureUserWorkspace } from '../services/workspaceService.js';

const emailSchema = z.string().trim().toLowerCase().email().max(254);

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
}).strict();

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict();

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1).max(512),
}).strict();

function requestContext(req: Request): SessionContext {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') };
}

export interface AuthController {
  register: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  listSessions: RequestHandler;
  revokeSession: RequestHandler;
  revokeAllSessions: RequestHandler;
}

export function createAuthController(config: AuthConfig): AuthController {
  return {
    register: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }
        const user = await registerUser(parsed.data.email, parsed.data.password);
        await createAuditLog({
          action: 'AUTH_REGISTERED',
          userId: user._id,
          ...requestContext(req),
        });
        const defaultWorkspaceId = await ensureUserWorkspace(user._id.toString());
        res.status(201).json({ ...toUserView(user), defaultWorkspaceId });
      } catch (error) {
        next(error);
      }
    },
    login: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }

        let user: IUser;
        try {
          user = await loginUser(parsed.data.email, parsed.data.password);
        } catch (error) {
          if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
            await createAuditLog({ action: 'AUTH_LOGIN_FAILED', ...requestContext(req) });
          }
          throw error;
        }

        await createAuditLog({
          action: 'AUTH_LOGIN_SUCCESS',
          userId: user._id,
          ...requestContext(req),
        });
        const tokens = await issueTokens(config, user._id, user.email, requestContext(req));
        const defaultWorkspaceId = await ensureUserWorkspace(user._id.toString());
        res.json({ ...tokens, user: toUserView(user), defaultWorkspaceId });
      } catch (error) {
        next(error);
      }
    },
    refresh: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = refreshSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }
        const tokens = await rotateRefreshToken(config, parsed.data.refreshToken, requestContext(req));
        res.json(tokens);
      } catch (error) {
        next(error);
      }
    },
    logout: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = refreshSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
          return;
        }
        const revoked = await revokeRefreshTokenFamily(parsed.data.refreshToken);
        if (revoked) {
          await createAuditLog({
            action: 'AUTH_LOGOUT',
            userId: revoked.userId,
            resource: 'session',
            resourceId: revoked.familyId,
            ...requestContext(req),
          });
        }
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
    listSessions: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = getAuthUser(req);
        const sessions = await listUserSessions(user.userId, user.sessionId);
        res.json(sessions);
      } catch (error) {
        next(error);
      }
    },
    revokeSession: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = getAuthUser(req);
        const sessionId = req.params.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          throw new Error('SESSION_NOT_FOUND');
        }
        const revoked = await revokeSessionFamily(user.userId, sessionId);
        if (!revoked) throw new Error('SESSION_NOT_FOUND');
        await createAuditLog({
          action: 'AUTH_LOGOUT',
          userId: user.userId,
          resource: 'session',
          resourceId: sessionId,
          metadata: { scope: 'session' },
          ...requestContext(req),
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
    revokeAllSessions: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = getAuthUser(req);
        await revokeAllUserSessions(user.userId);
        await createAuditLog({
          action: 'AUTH_LOGOUT',
          userId: user.userId,
          metadata: { scope: 'all' },
          ...requestContext(req),
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  };
}
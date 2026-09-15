import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { validateAPIKey, recordAPIKeyUsage } from '../services/apiKeyService.js';
import type { Permission } from '../auth/permissions.js';

export interface APIKeyAuthContext {
  apiKeyId: string;
  workspaceId: string;
  permissions: Permission[];
}

type RequestWithAPIKey = Request & { apiKeyContext?: APIKeyAuthContext };

export function getAPIKeyContext(req: Request): APIKeyAuthContext {
  const ctx = (req as RequestWithAPIKey).apiKeyContext;
  if (!ctx) throw new Error('API_KEY_CONTEXT_MISSING');
  return ctx;
}

export function createRequireAPIKey(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        return next(new Error('UNAUTHENTICATED'));
      }
      const token = header.slice('Bearer '.length).trim();
      if (!token) return next(new Error('UNAUTHENTICATED'));

      const apiKey = await validateAPIKey(token);
      if (!apiKey) return next(new Error('INVALID_API_KEY'));

      (req as RequestWithAPIKey).apiKeyContext = {
        apiKeyId: apiKey._id.toString(),
        workspaceId: apiKey.workspaceId.toString(),
        permissions: apiKey.permissions,
      };

      recordAPIKeyUsage(apiKey._id.toString()).catch(() => {});
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAPIKeyPermission(permission: Permission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ctx = getAPIKeyContext(req);
      if (!ctx.permissions.includes(permission)) {
        return next(new Error('FORBIDDEN'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

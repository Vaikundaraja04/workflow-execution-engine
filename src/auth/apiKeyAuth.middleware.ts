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

function extractToken(req: Request): string | undefined {
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return undefined;
}

export function createRequireAPIKey(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = extractToken(req);
      if (!token) {
        return next(new Error('UNAUTHENTICATED'));
      }

      const result = await validateAPIKey(token);
      if (!result.key) {
        return next(new Error(result.reason === 'EXPIRED' ? 'API_KEY_EXPIRED' : 'INVALID_API_KEY'));
      }

      (req as RequestWithAPIKey).apiKeyContext = {
        apiKeyId: result.key._id.toString(),
        workspaceId: result.key.workspaceId.toString(),
        permissions: result.key.permissions,
      };

      recordAPIKeyUsage(result.key._id.toString()).catch(() => {});
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

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccessToken } from './jwt.service.js';
import type { AccessTokenPayload, AuthConfig } from './jwt.service.js';

type RequestWithUser = Request & { user?: AccessTokenPayload };

export function createRequireAuth(config: AuthConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
      const token = header.slice('Bearer '.length).trim();
      if (!token) throw new Error('UNAUTHENTICATED');
      (req as RequestWithUser).user = verifyAccessToken(config, token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getAuthUser(req: Request): AccessTokenPayload {
  const user = (req as RequestWithUser).user;
  if (!user) throw new Error('UNAUTHENTICATED');
  return user;
}
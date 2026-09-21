import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getAuthUser } from '../../auth/auth.middleware.js';

export function readPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isPlatformAdminEmail(email: string): boolean {
  return readPlatformAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Restrict internal operator consoles to the platform admin allowlist
 * (PLATFORM_ADMIN_EMAILS, comma-separated).
 */
export function requirePlatformAdmin(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = getAuthUser(req);
      if (!isPlatformAdminEmail(user.email)) {
        next(new Error('FORBIDDEN'));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

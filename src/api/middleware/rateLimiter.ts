import { createHash } from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';

export interface AuthRateLimitOptions {
  windowMs: number;
  loginLimit: number;
  refreshLimit: number;
}

export interface AuthRateLimiters {
  login: RequestHandler;
  refresh: RequestHandler;
}

export const DEFAULT_AUTH_RATE_LIMIT: AuthRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  loginLimit: 5,
  refreshLimit: 20,
};

type KeyGenerator = (req: Request) => string;

function createLimiter(limit: number, windowMs: number, keyGenerator?: KeyGenerator): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, _res, next) => next(new Error('RATE_LIMITED')),
  });
}

function clientIpKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

function bodyString(req: Request, field: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Login attempts are counted per account. Counting per IP alone breaks behind a
 * hosting proxy (Render): every visitor shares the proxy's IP, so five logins by
 * anyone locked everybody out for 15 minutes.
 */
export function loginRateLimitKey(req: Request): string {
  const email = bodyString(req, 'email');
  return email ? `login:${email.toLowerCase()}` : clientIpKey(req);
}

/** Refresh attempts are counted per refresh token (one browser session). */
export function refreshRateLimitKey(req: Request): string {
  const token = bodyString(req, 'refreshToken');
  return token
    ? `refresh:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
    : clientIpKey(req);
}

export interface GlobalRateLimitOptions {
  windowMs: number;
  limit: number;
}

export const DEFAULT_GLOBAL_RATE_LIMIT: GlobalRateLimitOptions = {
  windowMs: 60_000,
  limit: 1_000,
};

export function createGlobalRateLimiter(
  options: GlobalRateLimitOptions = DEFAULT_GLOBAL_RATE_LIMIT,
): RequestHandler {
  return createLimiter(options.limit, options.windowMs);
}

export function createAuthRateLimiters(
  options: AuthRateLimitOptions = DEFAULT_AUTH_RATE_LIMIT,
): AuthRateLimiters {
  return {
    login: createLimiter(options.loginLimit, options.windowMs, loginRateLimitKey),
    refresh: createLimiter(options.refreshLimit, options.windowMs, refreshRateLimitKey),
  };
}

export interface SignupRateLimitOptions {
  windowMs: number;
  limit: number;
}

export const DEFAULT_SIGNUP_RATE_LIMIT: SignupRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 10,
};

export function createSignupRateLimiter(
  options: SignupRateLimitOptions = DEFAULT_SIGNUP_RATE_LIMIT,
): RequestHandler {
  return createLimiter(options.limit, options.windowMs);
}
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';

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

function createLimiter(limit: number, windowMs: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new Error('RATE_LIMITED')),
  });
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
    login: createLimiter(options.loginLimit, options.windowMs),
    refresh: createLimiter(options.refreshLimit, options.windowMs),
  };
}
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getAPIKeyContext } from '../../auth/apiKeyAuth.middleware.js';
import { getRateLimitService } from '../../services/rateLimitService.js';

export function createRateLimitMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getAPIKeyContext(req);
      const service = getRateLimitService();

      const { allowed, apiKeyResult, workspaceResult } = await service.checkLimits(
        ctx.apiKeyId,
        ctx.workspaceId,
      );

      // Add rate limit headers based on the API key limit
      res.setHeader('X-RateLimit-Limit', apiKeyResult.limit.toString());
      res.setHeader('X-RateLimit-Remaining', apiKeyResult.remaining.toString());
      res.setHeader('X-RateLimit-Reset', Math.floor(apiKeyResult.resetTime / 1000).toString());

      if (!allowed) {
        const retryAfter = !apiKeyResult.allowed ? apiKeyResult.retryAfter : workspaceResult.retryAfter;
        res.setHeader('Retry-After', retryAfter.toString());
        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            retryAfter,
          },
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          retryAfter,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function closeRateLimiter(): Promise<void> {
  const service = getRateLimitService();
  return service.close();
}

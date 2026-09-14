import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AuthConfig } from './jwt.service.js';
import { createAuthController } from './auth.controller.js';
import type { AuthRateLimiters } from '../api/middleware/rateLimiter.js';

export function createAuthRouter(
  config: AuthConfig,
  rateLimiters: AuthRateLimiters,
  requireAuth: RequestHandler,
) {
  const controller = createAuthController(config);
  const router = Router();

  router.post('/register', controller.register);
  router.post('/login', rateLimiters.login, controller.login);
  router.post('/refresh', rateLimiters.refresh, controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/sessions', requireAuth, controller.listSessions);
  router.delete('/sessions/:id', requireAuth, controller.revokeSession);
  router.delete('/sessions', requireAuth, controller.revokeAllSessions);

  return router;
}
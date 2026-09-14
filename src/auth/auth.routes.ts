import { Router } from 'express';
import type { AuthConfig } from './jwt.service.js';
import { createAuthController } from './auth.controller.js';
import type { AuthRateLimiters } from '../api/middleware/rateLimiter.js';

export function createAuthRouter(config: AuthConfig, rateLimiters: AuthRateLimiters) {
  const controller = createAuthController(config);
  const router = Router();

  router.post('/register', controller.register);
  router.post('/login', rateLimiters.login, controller.login);
  router.post('/refresh', rateLimiters.refresh, controller.refresh);
  router.post('/logout', controller.logout);

  return router;
}
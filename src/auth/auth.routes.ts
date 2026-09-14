import { Router } from 'express';
import type { AuthConfig } from './jwt.service.js';
import { createAuthController } from './auth.controller.js';

export function createAuthRouter(config: AuthConfig) {
  const controller = createAuthController(config);
  const router = Router();

  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);

  return router;
}
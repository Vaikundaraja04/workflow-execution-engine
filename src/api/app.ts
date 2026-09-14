import express from 'express';
import workflowRouter from './routes/workflowRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createExecutionRouter } from './routes/executionRoutes.js';
import type { ExecutionQueue } from '../queues/executionQueue.js';
import { UnavailableExecutionQueue } from '../queues/executionQueue.js';
import type { ExecutionCreationOptions } from '../services/executionService.js';
import { createAuthRouter } from '../auth/auth.routes.js';
import { createRequireAuth } from '../auth/auth.middleware.js';
import type { AuthConfig } from '../auth/jwt.service.js';
import { createAuthRateLimiters, DEFAULT_AUTH_RATE_LIMIT } from './middleware/rateLimiter.js';
import type { AuthRateLimitOptions } from './middleware/rateLimiter.js';

export interface AppOptions {
  executionQueue?: ExecutionQueue;
  executionCreationOptions?: ExecutionCreationOptions;
  auth: AuthConfig;
  authRateLimit?: Partial<AuthRateLimitOptions>;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const rateLimitOptions: AuthRateLimitOptions = {
    windowMs: options.authRateLimit?.windowMs ?? DEFAULT_AUTH_RATE_LIMIT.windowMs,
    loginLimit: options.authRateLimit?.loginLimit ?? DEFAULT_AUTH_RATE_LIMIT.loginLimit,
    refreshLimit: options.authRateLimit?.refreshLimit ?? DEFAULT_AUTH_RATE_LIMIT.refreshLimit,
  };
  const authRateLimiters = createAuthRateLimiters(rateLimitOptions);
  const requireAuth = createRequireAuth(options.auth);
  app.use('/api/auth', createAuthRouter(options.auth, authRateLimiters, requireAuth));

  app.use('/api/workflows', requireAuth, workflowRouter);
  app.use(
    '/api',
    createExecutionRouter(
      options.executionQueue ?? new UnavailableExecutionQueue(),
      options.executionCreationOptions ?? {},
      requireAuth,
    ),
  );

  // Unknown routes
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
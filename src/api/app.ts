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

export interface AppOptions {
  executionQueue?: ExecutionQueue;
  executionCreationOptions?: ExecutionCreationOptions;
  auth: AuthConfig;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter(options.auth));

  const requireAuth = createRequireAuth(options.auth);
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
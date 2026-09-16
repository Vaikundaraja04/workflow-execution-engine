import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { RequestHandler } from 'express';
import workflowRouter from './routes/workflowRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getRequestId } from './middleware/requestLogger.js';
import { createExecutionRouter } from './routes/executionRoutes.js';
import type { ExecutionQueue } from '../queues/executionQueue.js';
import { UnavailableExecutionQueue } from '../queues/executionQueue.js';
import type { ExecutionCreationOptions } from '../services/executionService.js';
import { createAuthRouter } from '../auth/auth.routes.js';
import { createWorkspaceRouter } from './routes/workspaceRoutes.js';
import { createAnalyticsRouter } from './routes/analyticsRoutes.js';
import { createAPIKeyRouter } from './routes/apiKeyRoutes.js';
import { createExternalWorkflowRouter } from './routes/externalWorkflowRoutes.js';
import { createWebhookRouter } from './routes/webhookRoutes.js';
import { createDeveloperRouter } from './routes/developerRoutes.js';
import { createSubscriptionRouter } from './routes/subscriptionRoutes.js';
import { createBillingRouter } from './routes/billingRoutes.js';
import { createHealthChecks, createHealthRouter } from './routes/healthRoutes.js';
import type { HealthOptions } from './routes/healthRoutes.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createAuditRouter } from './routes/auditRoutes.js';
import { createSsoRouter, createSSOAdminRouter } from './routes/ssoRoutes.js';
import { createSCIMRouter } from './routes/scimRoutes.js';
import { createRequireAuth } from '../auth/auth.middleware.js';
import type { AuthConfig } from '../auth/jwt.service.js';
import {
  createAuthRateLimiters,
  createGlobalRateLimiter,
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_GLOBAL_RATE_LIMIT,
} from './middleware/rateLimiter.js';
import type { AuthRateLimitOptions, GlobalRateLimitOptions } from './middleware/rateLimiter.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { buildOpenApiDocument } from './openapi.js';
import type { WebhookQueue } from '../queues/webhookQueue.js';
import { UnavailableWebhookQueue } from '../queues/webhookQueue.js';

const OPENAPI_DOCUMENT = buildOpenApiDocument();

const docsContentSecurityPolicy: RequestHandler = (_req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  );
  next();
};

export interface AppOptions {
  executionQueue?: ExecutionQueue;
  executionCreationOptions?: ExecutionCreationOptions;
  webhookQueue?: WebhookQueue;
  auth: AuthConfig;
  authRateLimit?: Partial<AuthRateLimitOptions>;
  rateLimit?: Partial<GlobalRateLimitOptions>;
  corsOrigins?: string[];
  health?: HealthOptions;
  docs?: boolean;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(requestLogger());
  app.use(express.json({ limit: '1mb' }));
  app.use(createCorsMiddleware(options.corsOrigins ?? []));

  app.use('/health', createHealthRouter(createHealthChecks(options.health ?? {})));

  if (options.docs !== false) {
    app.get('/api/openapi.json', (_req, res) => {
      res.json(OPENAPI_DOCUMENT);
    });
    app.use(
      '/api/docs',
      docsContentSecurityPolicy,
      swaggerUi.serve,
      swaggerUi.setup(OPENAPI_DOCUMENT, { customSiteTitle: 'Workflow Execution Engine API' }),
    );
  }

  const globalRateLimit: GlobalRateLimitOptions = {
    windowMs: options.rateLimit?.windowMs ?? DEFAULT_GLOBAL_RATE_LIMIT.windowMs,
    limit: options.rateLimit?.limit ?? DEFAULT_GLOBAL_RATE_LIMIT.limit,
  };
  app.use('/api', createGlobalRateLimiter(globalRateLimit));
  const rateLimitOptions: AuthRateLimitOptions = {
    windowMs: options.authRateLimit?.windowMs ?? DEFAULT_AUTH_RATE_LIMIT.windowMs,
    loginLimit: options.authRateLimit?.loginLimit ?? DEFAULT_AUTH_RATE_LIMIT.loginLimit,
    refreshLimit: options.authRateLimit?.refreshLimit ?? DEFAULT_AUTH_RATE_LIMIT.refreshLimit,
  };
  const authRateLimiters = createAuthRateLimiters(rateLimitOptions);
  const requireAuth = createRequireAuth(options.auth);
  app.use('/api/auth', createAuthRouter(options.auth, authRateLimiters, requireAuth));
  app.use('/api/workspaces', requireAuth, createWorkspaceRouter());

  app.use('/api/workflows', requireAuth, workflowRouter);
  app.use('/api/analytics', requireAuth, createAnalyticsRouter());
  app.use('/api/v1', createExternalWorkflowRouter(
    options.executionQueue ?? new UnavailableExecutionQueue(),
    options.executionCreationOptions ?? {},
  ));
  app.use('/api/v1/billing', createBillingRouter());
  app.use('/api/v1', requireAuth, createAPIKeyRouter());
  app.use('/api/v1/subscription', requireAuth, createSubscriptionRouter());
  app.use(
    '/api/v1/webhooks',
    requireAuth,
    createWebhookRouter(
      options.webhookQueue ?? new UnavailableWebhookQueue(),
    ),
  );
  app.use('/api/v1/developer', requireAuth, createDeveloperRouter());
  app.use('/api/v1/admin', requireAuth, createAdminRouter(options));
  app.use('/api/admin', requireAuth, createAdminRouter(options));
  app.use('/api/v1/audit', requireAuth, createAuditRouter());
  app.use('/api/audit', requireAuth, createAuditRouter());
  app.use('/api/v1/workspaces/:workspaceId/audit', requireAuth, createAuditRouter());
  app.use('/api/workspaces/:workspaceId/audit', requireAuth, createAuditRouter());

  // SSO & SCIM Workspace Admin Routes
  app.use('/api/v1/admin/workspaces/:workspaceId', requireAuth, createSSOAdminRouter());
  app.use('/api/admin/workspaces/:workspaceId', requireAuth, createSSOAdminRouter());
  app.use('/api/workspaces/:workspaceId', requireAuth, createSSOAdminRouter());
  app.use('/api/workspaces/:id', requireAuth, createSSOAdminRouter());

  // SSO Routes (Public authentication endpoints)
  app.use('/api/auth/sso', createSsoRouter());

  // SCIM Routes (Provisioning API)
  app.use('/scim/v2', createSCIMRouter());

  app.use(
    '/api',
    createExecutionRouter(
      options.executionQueue ?? new UnavailableExecutionQueue(),
      options.executionCreationOptions ?? {},
      requireAuth,
    ),
  );

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: getRequestId(req) },
    });
  });

  app.use(errorHandler);

  return app;
}

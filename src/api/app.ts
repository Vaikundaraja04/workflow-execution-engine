import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { RequestHandler } from 'express';
import workflowRouter from './routes/workflowRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getRequestId } from './middleware/requestLogger.js';
import { createExecutionRouter } from './routes/executionRoutes.js';
import { createCommentRoutes } from './routes/commentRoutes.js';
import { createLockRoutes } from './routes/lockRoutes.js';
import { createNotificationRoutes } from './routes/notificationRoutes.js';
import { createActivityRouter } from './routes/activityRoutes.js';
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
import { createTemplateRouter } from './routes/templateRoutes.js';
import { createMarketplaceRouter } from './routes/marketplaceRoutes.js';
import { createGovernanceRouter } from './routes/governanceRoutes.js';
import aiRoutes, { aiConfigRouter } from './routes/aiRoutes.js';
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
// Phase 8: Enterprise Security & Compliance Platform
import securityRoutes from './routes/securityRoutes.js';
import complianceRoutes from './routes/complianceRoutes.js';
import privacyRoutes from './routes/privacyRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import secretsRoutes from './routes/secretsRoutes.js';
// Phase 9: Enterprise Operations, Analytics & Production Intelligence Platform
import analyticsEnterpriseRoutes from './routes/analyticsEnterpriseRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import operationsRoutes from './routes/operationsRoutes.js';
// Phase 11: Global Scale, Multi-Region & Cloud Platform
import { tracingMiddleware } from '../observability/tracing.js';
import { createRegionMiddleware } from '../middleware/regionMiddleware.js';
import { RegionService } from '../services/regionService.js';
import platformRoutes from './routes/platformRoutes.js';
// Phase 12: AI-Native Automation & Autonomous Operations
import selfHealingRoutes from './routes/selfHealingRoutes.js';
import agentRoutes from './routes/agentRoutes.js';

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
  regionService?: RegionService;
  currentRegion?: string;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(tracingMiddleware('workflow-execution-engine'));
  app.use(requestLogger());
  app.use(express.json({ limit: '1mb' }));
  app.use(createCorsMiddleware(options.corsOrigins ?? []));

  const regionService = options.regionService ?? new RegionService();
  const currentRegion = options.currentRegion ?? (process.env.REGION || 'us-east-1');
  app.use('/api', createRegionMiddleware(regionService, currentRegion));

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
  app.use('/api/v1/templates', requireAuth, createTemplateRouter());
  app.use('/api/v1/marketplace', requireAuth, createMarketplaceRouter());
  app.use('/api/marketplace', requireAuth, createMarketplaceRouter());
  app.use('/api/v1/governance', requireAuth, createGovernanceRouter());
  app.use('/api/governance', requireAuth, createGovernanceRouter());
  app.use('/api/v1/ai', requireAuth, aiRoutes);
  app.use('/api/v1/admin/ai', requireAuth, aiConfigRouter);
  app.use('/api/v1/admin', requireAuth, createAdminRouter(options));
  app.use('/api/admin', requireAuth, createAdminRouter(options));
  app.use('/api/v1/audit', requireAuth, createAuditRouter());
  app.use('/api/audit', requireAuth, createAuditRouter());
  app.use('/api/v1/workspaces/:workspaceId/audit', requireAuth, createAuditRouter());
  app.use('/api/workspaces/:workspaceId/audit', requireAuth, createAuditRouter());

  // Phase 8: Enterprise Security & Compliance Platform
  app.use('/api/v1/security', securityRoutes());
  app.use('/api/v1/compliance', complianceRoutes());
  app.use('/api/v1/privacy', privacyRoutes());
  app.use('/api/v1/sessions', sessionRoutes());
  app.use('/api/v1/secrets', secretsRoutes());

  // Phase 9: Enterprise Operations, Analytics & Production Intelligence Platform
  app.use('/api/v1/analytics', analyticsEnterpriseRoutes());
  app.use('/api/v1/reports', reportRoutes());
  app.use('/api/v1/operations', operationsRoutes());

  // Phase 11: Global Scale, Multi-Region & Cloud Platform
  app.use('/api/v1/platform', requireAuth, platformRoutes());
  app.use('/api/platform', requireAuth, platformRoutes());

// Phase 12: Enterprise AI-Native Automation & Autonomous Operations Platform
  app.use('/api/v1/self-healing', requireAuth, selfHealingRoutes);
  app.use('/api/v1/agent', requireAuth, agentRoutes);

  // Collaboration routes
  app.use('/api/v1/comments', requireAuth, createCommentRoutes(requireAuth));
  app.use('/api/v1/locks', requireAuth, createLockRoutes(requireAuth));
  app.use('/api/v1/notifications', requireAuth, createNotificationRoutes(requireAuth));
  app.use('/api/v1/activity', requireAuth, createActivityRouter(requireAuth));

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

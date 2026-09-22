import type { Request, Response, NextFunction } from 'express';
import { errorFields, logger } from '../../observability/logger.js';
import { getRequestId, requestPath } from './requestLogger.js';

const ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  INVALID_REQUEST: { status: 400, code: 'INVALID_REQUEST', message: 'Invalid request' },
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' },
  RATE_LIMIT_EXCEEDED: { status: 429, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
  UNAUTHENTICATED: { status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required' },
  INVALID_TOKEN: { status: 401, code: 'INVALID_TOKEN', message: 'Access token is invalid' },
  TOKEN_EXPIRED: { status: 401, code: 'TOKEN_EXPIRED', message: 'Access token has expired' },
  INVALID_CREDENTIALS: { status: 401, code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
  INVALID_REFRESH_TOKEN: { status: 401, code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired' },
  EMAIL_TAKEN: { status: 409, code: 'EMAIL_TAKEN', message: 'Email is already registered' },
  INVALID_JSON: { status: 400, code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
  INVALID_WORKFLOW_ID: { status: 400, code: 'INVALID_WORKFLOW_ID', message: 'Invalid workflow ID' },
  INVALID_EXECUTION_ID: { status: 400, code: 'INVALID_EXECUTION_ID', message: 'Invalid execution ID' },
  WORKFLOW_NOT_FOUND: { status: 404, code: 'WORKFLOW_NOT_FOUND', message: 'Workflow was not found' },
  VERSION_NOT_FOUND: { status: 404, code: 'VERSION_NOT_FOUND', message: 'Workflow version was not found' },
  EXECUTION_NOT_FOUND: { status: 404, code: 'EXECUTION_NOT_FOUND', message: 'Execution was not found' },
  EXECUTION_NOT_FAILED: { status: 409, code: 'EXECUTION_NOT_FAILED', message: 'Execution has not failed' },
  SESSION_NOT_FOUND: { status: 404, code: 'SESSION_NOT_FOUND', message: 'Session was not found' },
  INVALID_WORKSPACE_ID: { status: 400, code: 'INVALID_WORKSPACE_ID', message: 'Invalid workspace ID' },
  WORKSPACE_NOT_FOUND: { status: 404, code: 'WORKSPACE_NOT_FOUND', message: 'Workspace was not found' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN', message: 'Insufficient permission for this action' },
  PERMISSION_DENIED: { status: 403, code: 'PERMISSION_DENIED', message: 'Workspace membership required' },
  MEMBER_NOT_FOUND: { status: 404, code: 'MEMBER_NOT_FOUND', message: 'Workspace member was not found' },
  INVITATION_NOT_FOUND: { status: 404, code: 'INVITATION_NOT_FOUND', message: 'No pending invitation was found' },
  USER_NOT_FOUND: { status: 404, code: 'USER_NOT_FOUND', message: 'User was not found' },
  MEMBER_ALREADY_EXISTS: { status: 409, code: 'MEMBER_ALREADY_EXISTS', message: 'User is already a member of this workspace' },
  OWNER_ROLE_IMMUTABLE: { status: 409, code: 'OWNER_ROLE_IMMUTABLE', message: 'Workspace ownership is transferred, not reassigned' },
  INVALID_TRANSFER_TARGET: { status: 400, code: 'INVALID_TRANSFER_TARGET', message: 'Ownership transfer target is invalid' },
  NO_PUBLISHED_VERSION: { status: 409, code: 'NO_PUBLISHED_VERSION', message: 'Workflow has no published version' },
  EXECUTION_NOT_REPLAYABLE: { status: 409, code: 'EXECUTION_NOT_REPLAYABLE', message: 'Execution can only be replayed after it finishes' },
  IDEMPOTENCY_CONFLICT: { status: 409, code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key was reused with different input' },
  VERSION_CONFLICT: { status: 409, code: 'VERSION_CONFLICT', message: 'Workflow version conflict' },
  QUEUE_UNAVAILABLE: { status: 503, code: 'QUEUE_UNAVAILABLE', message: 'Execution queue is unavailable' },
  INVALID_WORKFLOW_SCHEMA: { status: 422, code: 'INVALID_WORKFLOW_SCHEMA', message: 'Draft schema is invalid' },
  INVALID_API_KEY: { status: 401, code: 'INVALID_API_KEY', message: 'API key is invalid or revoked' },
  API_KEY_NOT_FOUND: { status: 404, code: 'API_KEY_NOT_FOUND', message: 'API key was not found' },
  INVALID_API_KEY_ID: { status: 400, code: 'INVALID_API_KEY_ID', message: 'Invalid API key ID' },
  API_KEY_EXPIRED: { status: 401, code: 'API_KEY_EXPIRED', message: 'API key has expired' },
  INVALID_WORKFLOW_GRAPH: { status: 422, code: 'INVALID_WORKFLOW_GRAPH', message: 'Draft graph is invalid' },
  INVALID_OPTIMIZATION_ID: { status: 400, code: 'INVALID_OPTIMIZATION_ID', message: 'Invalid optimization plan ID' },
  INVALID_OPTIMIZATION_STATUS: { status: 400, code: 'INVALID_OPTIMIZATION_STATUS', message: 'Invalid optimization plan status filter' },
  OPTIMIZATION_PLAN_NOT_FOUND: { status: 404, code: 'OPTIMIZATION_PLAN_NOT_FOUND', message: 'Optimization plan was not found' },
  OPTIMIZATION_PLAN_NOT_PENDING: { status: 409, code: 'OPTIMIZATION_PLAN_NOT_PENDING', message: 'Optimization plan is not pending' },
  OPTIMIZATION_PLAN_ALREADY_APPLIED: { status: 409, code: 'OPTIMIZATION_PLAN_ALREADY_APPLIED', message: 'Optimization plan was already applied' },
  OPTIMIZATION_PLAN_NOT_APPLICABLE: { status: 409, code: 'OPTIMIZATION_PLAN_NOT_APPLICABLE', message: 'Optimization plan cannot be applied in its current state' },
  OPTIMIZATION_PLAN_APPROVAL_REQUIRED: { status: 403, code: 'OPTIMIZATION_PLAN_APPROVAL_REQUIRED', message: 'Optimization plan requires approval before it can be applied' },
  OPTIMIZATION_NO_APPLICABLE_CHANGES: { status: 422, code: 'OPTIMIZATION_NO_APPLICABLE_CHANGES', message: 'Optimization plan contains no applicable changes' },
  AI_GOVERNANCE_DENIED: { status: 403, code: 'AI_GOVERNANCE_DENIED', message: 'AI operation denied by governance policy' },
  AI_GOVERNANCE_APPROVAL_REQUIRED: { status: 403, code: 'AI_GOVERNANCE_APPROVAL_REQUIRED', message: 'AI operation requires governance approval' },
  AI_GOVERNANCE_PROMPT_BLOCKED: { status: 422, code: 'AI_GOVERNANCE_PROMPT_BLOCKED', message: 'Prompt blocked by governance policy' },
  AI_GOVERNANCE_QUOTA_BLOCKED: { status: 429, code: 'AI_GOVERNANCE_QUOTA_BLOCKED', message: 'AI usage limit exceeded' },
  INVALID_GOVERNANCE_POLICY: { status: 400, code: 'INVALID_GOVERNANCE_POLICY', message: 'Invalid governance policy' },
  GOVERNANCE_POLICY_NOT_FOUND: { status: 404, code: 'GOVERNANCE_POLICY_NOT_FOUND', message: 'Governance policy was not found' },
  APPROVAL_NOT_FOUND: { status: 404, code: 'APPROVAL_NOT_FOUND', message: 'Approval request was not found' },
  APPROVAL_NOT_PENDING: { status: 409, code: 'APPROVAL_NOT_PENDING', message: 'Approval request is not pending' },
  INVALID_WEBHOOK_ID: { status: 400, code: 'INVALID_WEBHOOK_ID', message: 'Invalid webhook ID' },
  WEBHOOK_NOT_FOUND: { status: 404, code: 'WEBHOOK_NOT_FOUND', message: 'Webhook was not found' },
  WEBHOOK_URL_MUST_BE_HTTPS: { status: 400, code: 'WEBHOOK_URL_MUST_BE_HTTPS', message: 'Webhook URL must use HTTPS' },
  WEBHOOK_EVENTS_REQUIRED: { status: 400, code: 'WEBHOOK_EVENTS_REQUIRED', message: 'At least one webhook event is required' },
  INVALID_WEBHOOK_EVENT: { status: 400, code: 'INVALID_WEBHOOK_EVENT', message: 'Invalid webhook event' },
  INVALID_WEBHOOK_DELIVERY_ID: { status: 400, code: 'INVALID_WEBHOOK_DELIVERY_ID', message: 'Invalid webhook delivery ID' },
  WEBHOOK_DELIVERY_NOT_FOUND: { status: 404, code: 'WEBHOOK_DELIVERY_NOT_FOUND', message: 'Webhook delivery was not found' },
  WEBHOOK_DELIVERY_NOT_FAILED: { status: 409, code: 'WEBHOOK_DELIVERY_NOT_FAILED', message: 'Only failed deliveries can be retried' },
  INVALID_AUDIT_LOG_ID: { status: 400, code: 'INVALID_AUDIT_LOG_ID', message: 'Invalid audit log ID' },
  AUDIT_LOG_NOT_FOUND: { status: 404, code: 'AUDIT_LOG_NOT_FOUND', message: 'Audit log was not found' },
  INVALID_USER_ID: { status: 400, code: 'INVALID_USER_ID', message: 'Invalid user ID' },
  WORKSPACE_SUSPENDED: { status: 403, code: 'WORKSPACE_SUSPENDED', message: 'Workspace is suspended' },
  WORKSPACE_DELETED: { status: 404, code: 'WORKSPACE_DELETED', message: 'Workspace is deleted' },
  CANNOT_CANCEL_COMPLETED_EXECUTION: { status: 409, code: 'CANNOT_CANCEL_COMPLETED_EXECUTION', message: 'Cannot cancel an execution that has already completed' },
  CANNOT_RETRY_NON_FAILED_EXECUTION: { status: 409, code: 'CANNOT_RETRY_NON_FAILED_EXECUTION', message: 'Only failed executions can be retried' },
  INVALID_QUEUE_NAME: { status: 400, code: 'INVALID_QUEUE_NAME', message: 'Invalid queue name' },
  INVALID_RETENTION_DAYS: { status: 400, code: 'INVALID_RETENTION_DAYS', message: 'Retention days must be at least 1' },
  SUBSCRIPTION_NOT_FOUND: { status: 404, code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' },
  INVALID_PLAN: { status: 400, code: 'INVALID_PLAN', message: 'Invalid plan specified' },
  SUBSCRIPTION_ALREADY_CANCELLED: { status: 400, code: 'SUBSCRIPTION_ALREADY_CANCELLED', message: 'Subscription is already cancelled or expired' },
  PLAN_LIMIT_EXCEEDED: { status: 403, code: 'PLAN_LIMIT_EXCEEDED', message: 'Plan limit exceeded' },
  TENANT_SUSPENDED: { status: 403, code: 'TENANT_SUSPENDED', message: 'Tenant is suspended' },
  TENANT_NOT_FOUND: { status: 404, code: 'TENANT_NOT_FOUND', message: 'Tenant account was not found' },
  CUSTOMER_NOT_FOUND: { status: 404, code: 'CUSTOMER_NOT_FOUND', message: 'Customer was not found' },
  FEATURE_NOT_ENTITLED: { status: 403, code: 'FEATURE_NOT_ENTITLED', message: 'Plan does not include this feature' },
  NOT_DEMO_TENANT: { status: 403, code: 'NOT_DEMO_TENANT', message: 'Workspace is not a demo sandbox' },
  BILLING_PROVIDER_NOT_CONFIGURED: { status: 503, code: 'BILLING_PROVIDER_NOT_CONFIGURED', message: 'Billing provider is not configured' },
  INVALID_BILLING_PROVIDER: { status: 400, code: 'INVALID_BILLING_PROVIDER', message: 'Unknown billing provider' },
  TRIAL_ALREADY_STARTED: { status: 409, code: 'TRIAL_ALREADY_STARTED', message: 'Subscription is already trialing' },
  INVALID_TRIAL_DAYS: { status: 400, code: 'INVALID_TRIAL_DAYS', message: 'Invalid trial length' },
  SSO_PROVIDER_NOT_FOUND: { status: 404, code: 'SSO_PROVIDER_NOT_FOUND', message: 'SSO provider was not found' },
  SSO_PROVIDER_DISABLED: { status: 400, code: 'SSO_PROVIDER_DISABLED', message: 'SSO provider is disabled' },
  SSO_STATE_INVALID: { status: 400, code: 'SSO_STATE_INVALID', message: 'SSO state is invalid or expired' },
  SSO_CALLBACK_INVALID: { status: 400, code: 'SSO_CALLBACK_INVALID', message: 'SSO callback is invalid' },
  SSO_IDENTITY_CONFLICT: { status: 409, code: 'SSO_IDENTITY_CONFLICT', message: 'SSO identity is already linked to another user' },
  SSO_DOMAIN_NOT_VERIFIED: { status: 403, code: 'SSO_DOMAIN_NOT_VERIFIED', message: 'Domain is not verified for SSO' },
  SSO_REQUIRED: { status: 403, code: 'SSO_REQUIRED', message: 'SSO authentication is required for this workspace' },
  SCIM_UNAUTHORIZED: { status: 401, code: 'SCIM_UNAUTHORIZED', message: 'SCIM authentication failed' },
  SCIM_USER_NOT_FOUND: { status: 404, code: 'SCIM_USER_NOT_FOUND', message: 'SCIM user was not found' },
  SCIM_CONFLICT: { status: 409, code: 'SCIM_CONFLICT', message: 'SCIM user already exists' },
  SCIM_TOKEN_NOT_FOUND: { status: 404, code: 'SCIM_TOKEN_NOT_FOUND', message: 'SCIM token was not found' },
  INVALID_PROVIDER_ID: { status: 400, code: 'INVALID_PROVIDER_ID', message: 'Invalid identity provider ID' },
  TEMPLATE_NOT_FOUND: { status: 404, code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' },
  TEMPLATE_ACCESS_DENIED: { status: 403, code: 'TEMPLATE_ACCESS_DENIED', message: 'Access denied to template' },
  TEMPLATE_PUBLISH_ERROR: { status: 400, code: 'TEMPLATE_PUBLISH_ERROR', message: 'Template cannot be published' },
  TEMPLATE_VALIDATION_ERROR: { status: 400, code: 'TEMPLATE_VALIDATION_ERROR', message: 'Template validation failed' },
  INVALID_TEMPLATE_PACKAGE: { status: 400, code: 'INVALID_TEMPLATE_PACKAGE', message: 'Invalid template package' },
  // Phase 14: Go-To-Market, Customer Acquisition & Revenue Engine
  PRODUCT_PLAN_NOT_FOUND: { status: 404, code: 'PRODUCT_PLAN_NOT_FOUND', message: 'Product plan was not found' },
  SOLUTION_NOT_FOUND: { status: 404, code: 'SOLUTION_NOT_FOUND', message: 'Solution package was not found' },
  INVALID_LEAD_ID: { status: 400, code: 'INVALID_LEAD_ID', message: 'Invalid lead ID' },
  LEAD_NOT_FOUND: { status: 404, code: 'LEAD_NOT_FOUND', message: 'Lead was not found' },
  INVALID_PAYMENT_ID: { status: 400, code: 'INVALID_PAYMENT_ID', message: 'Invalid payment identifier' },
  UNSUPPORTED_PROVIDER_OPERATION: { status: 501, code: 'UNSUPPORTED_PROVIDER_OPERATION', message: 'The billing provider does not support this operation' },
  // Phase 15: SaaS Revenue Launch & Customer Acquisition Platform
  ALREADY_ON_PACKAGE: { status: 409, code: 'ALREADY_ON_PACKAGE', message: 'The workspace is already on this package' },
  CHECKOUT_NOT_SETTLED: { status: 402, code: 'CHECKOUT_NOT_SETTLED', message: 'The payment has not settled yet' },
  ONBOARDING_STEP_NOT_FOUND: { status: 404, code: 'ONBOARDING_STEP_NOT_FOUND', message: 'Unknown onboarding step' },
  ONBOARDING_NOT_STARTED: { status: 404, code: 'ONBOARDING_NOT_STARTED', message: 'The onboarding wizard has not been started' },
  ONBOARDING_INCOMPLETE: { status: 409, code: 'ONBOARDING_INCOMPLETE', message: 'The required onboarding steps are not complete' },
  ONBOARDING_STEP_REQUIRED: { status: 400, code: 'ONBOARDING_STEP_REQUIRED', message: 'This onboarding step cannot be skipped' },
  EMAIL_TEMPLATE_NOT_FOUND: { status: 404, code: 'EMAIL_TEMPLATE_NOT_FOUND', message: 'Unknown notification template' },
  INVALID_WEBHOOK_SIGNATURE: { status: 400, code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Webhook signature verification failed' },
  // Phase 16: Customer Acquisition & SaaS Growth Engine
  DEMO_SCENARIO_NOT_FOUND: { status: 404, code: 'DEMO_SCENARIO_NOT_FOUND', message: 'Demo scenario was not found' },
  INVALID_PARTNER_ID: { status: 400, code: 'INVALID_PARTNER_ID', message: 'Invalid partner ID' },
  PARTNER_NOT_FOUND: { status: 404, code: 'PARTNER_NOT_FOUND', message: 'Partner was not found' },
  PARTNER_CODE_TAKEN: { status: 409, code: 'PARTNER_CODE_TAKEN', message: 'Partner code is already in use' },
  INVALID_REFERRAL: { status: 400, code: 'INVALID_REFERRAL', message: 'Invalid referral input' },
  PROPOSAL_NOT_ALLOWED: { status: 403, code: 'PROPOSAL_NOT_ALLOWED', message: 'The proposal cannot be generated for this lead' },
  // Phase 17: Ecosystem & Marketplace Revenue Platform
  LISTING_NOT_FOUND: { status: 404, code: 'LISTING_NOT_FOUND', message: 'Marketplace listing was not found' },
  PRICE_NOT_SET: { status: 409, code: 'PRICE_NOT_SET', message: 'Marketplace pricing is not active for this asset' },
  INVALID_PRICING: { status: 400, code: 'INVALID_PRICING', message: 'Invalid marketplace pricing' },
  INVALID_PURCHASE: { status: 400, code: 'INVALID_PURCHASE', message: 'This asset cannot be purchased by this workspace' },
  LICENSE_REQUIRED: { status: 403, code: 'LICENSE_REQUIRED', message: 'An active license is required for this asset' },
  LICENSE_NOT_FOUND: { status: 404, code: 'LICENSE_NOT_FOUND', message: 'License was not found' },
  LICENSE_ALREADY_ACTIVE: { status: 409, code: 'LICENSE_ALREADY_ACTIVE', message: 'This workspace already holds an active license' },
  PAYMENT_NOT_SETTLED: { status: 402, code: 'PAYMENT_NOT_SETTLED', message: 'The payment has not settled' },
  TRANSACTION_NOT_FOUND: { status: 404, code: 'TRANSACTION_NOT_FOUND', message: 'Revenue transaction was not found' },
  TRANSACTION_ALREADY_REFUNDED: { status: 409, code: 'TRANSACTION_ALREADY_REFUNDED', message: 'The transaction is already refunded' },
  INVALID_REFUND_AMOUNT: { status: 400, code: 'INVALID_REFUND_AMOUNT', message: 'Invalid refund amount' },
  NO_AVAILABLE_BALANCE: { status: 409, code: 'NO_AVAILABLE_BALANCE', message: 'No available balance to pay out' },
  REVIEW_NOT_ALLOWED: { status: 403, code: 'REVIEW_NOT_ALLOWED', message: 'A verified purchase or active license is required to review this asset' },
  REVIEW_ALREADY_EXISTS: { status: 409, code: 'REVIEW_ALREADY_EXISTS', message: 'This workspace already reviewed this asset' },
  REVIEW_NOT_FOUND: { status: 404, code: 'REVIEW_NOT_FOUND', message: 'Review was not found' },
  WORKFLOW_LISTING_NOT_FOUND: { status: 404, code: 'WORKFLOW_LISTING_NOT_FOUND', message: 'Workflow marketplace listing was not found' },
  WORKFLOW_TEMPLATE_NOT_FOUND: { status: 404, code: 'WORKFLOW_TEMPLATE_NOT_FOUND', message: 'Workflow template was not found in this workspace' },
  INVALID_WORKFLOW_LISTING: { status: 400, code: 'INVALID_WORKFLOW_LISTING', message: 'Invalid workflow marketplace listing' },
  INVALID_RATING: { status: 400, code: 'INVALID_RATING', message: 'Rating must be between 1 and 5' },
  PARTNER_SOLUTION_NOT_FOUND: { status: 404, code: 'PARTNER_SOLUTION_NOT_FOUND', message: 'Partner solution was not found' },
  // Phase 18: Enterprise Production Completion Platform
  ACCOUNT_NOT_FOUND: { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Enterprise account was not found' },
  ACCOUNT_ALREADY_EXISTS: { status: 409, code: 'ACCOUNT_ALREADY_EXISTS', message: 'This workspace already has an enterprise account' },
  INVALID_ACCOUNT: { status: 400, code: 'INVALID_ACCOUNT', message: 'Invalid enterprise account input' },
  TICKET_NOT_FOUND: { status: 404, code: 'TICKET_NOT_FOUND', message: 'Support ticket was not found' },
  INVALID_TICKET: { status: 400, code: 'INVALID_TICKET', message: 'Invalid support ticket input' },
  INVALID_TICKET_TRANSITION: { status: 409, code: 'INVALID_TICKET_TRANSITION', message: 'This ticket status transition is not allowed' },
  SLA_POLICY_NOT_FOUND: { status: 404, code: 'SLA_POLICY_NOT_FOUND', message: 'SLA policy was not found' },
  INVALID_SLA_POLICY: { status: 400, code: 'INVALID_SLA_POLICY', message: 'Invalid SLA policy input' },
};

type JsonSyntaxError = SyntaxError & {
  status?: unknown;
  body?: unknown;
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = getRequestId(req);
  const context = { requestId, method: req.method, path: requestPath(req) };

  if (err instanceof SyntaxError) {
    const jsonErr = err as JsonSyntaxError;
    if (jsonErr.status === 400 && 'body' in jsonErr) {
      logger.warn('request_rejected', { ...context, code: 'INVALID_JSON', status: 400 });
      return res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON', requestId },
      });
    }
  }
  if (err instanceof Error) {
    if (err.message === 'PLAN_LIMIT_EXCEEDED') {
      const anyErr = err as any;
      logger.warn('request_rejected', { ...context, code: 'PLAN_LIMIT_EXCEEDED', status: 403 });
      return res.status(403).json({
        error: {
          code: 'PLAN_LIMIT_EXCEEDED',
          message: 'Plan limit exceeded',
          resource: anyErr.resource,
          limit: anyErr.limit,
          currentUsage: anyErr.currentUsage,
          requestId,
        },
      });
    }
    // Handle TemplateValidationError by error name
    if (err.name === 'TemplateValidationError') {
      // Use the original error message from the service to preserve graph details
      logger.warn('request_rejected', { ...context, code: 'TEMPLATE_VALIDATION_ERROR', status: 400, ...errorFields(err) });
      return res.status(400).json({
        error: { code: 'TEMPLATE_VALIDATION_ERROR', message: err.message, requestId },
      });
    }
    const rawCode = (err as { code?: unknown }).code;
    const mapped =
      ERROR_MAP[err.message] ?? (typeof rawCode === 'string' ? ERROR_MAP[rawCode] : undefined);
    if (mapped) {
      const emit = mapped.status >= 500 ? logger.error : logger.warn;
      emit('request_rejected', { ...context, code: mapped.code, status: mapped.status });
      return res.status(mapped.status).json({
        error: { code: mapped.code, message: mapped.message, requestId },
      });
    }
    const mongoErr = err as { code?: number };
    if (mongoErr.code === 11000) {
      logger.warn('request_rejected', { ...context, code: 'VERSION_CONFLICT', status: 409 });
      return res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: 'Workflow version conflict', requestId },
      });
    }
    logger.error('request_failed', { ...context, ...errorFields(err) });
  } else {
    logger.error('request_failed', { ...context, errorMessage: String(err) });
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId },
  });
}

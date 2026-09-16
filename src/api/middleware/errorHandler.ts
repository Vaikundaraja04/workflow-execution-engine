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
    const mapped = ERROR_MAP[err.message];
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

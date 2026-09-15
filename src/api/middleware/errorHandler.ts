import type { Request, Response, NextFunction } from 'express';

const ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  INVALID_REQUEST: { status: 400, code: 'INVALID_REQUEST', message: 'Invalid request' },
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' },
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
  IDEMPOTENCY_CONFLICT: { status: 409, code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key was reused with different input' },
  VERSION_CONFLICT: { status: 409, code: 'VERSION_CONFLICT', message: 'Workflow version conflict' },
  QUEUE_UNAVAILABLE: { status: 503, code: 'QUEUE_UNAVAILABLE', message: 'Execution queue is unavailable' },
  INVALID_WORKFLOW_SCHEMA: { status: 422, code: 'INVALID_WORKFLOW_SCHEMA', message: 'Draft schema is invalid' },
  INVALID_WORKFLOW_GRAPH: { status: 422, code: 'INVALID_WORKFLOW_GRAPH', message: 'Draft graph is invalid' },
};

type JsonSyntaxError = SyntaxError & {
  status?: unknown;
  body?: unknown;
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof SyntaxError) {
    const jsonErr = err as JsonSyntaxError;
    if (jsonErr.status === 400 && 'body' in jsonErr) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' } });
    }
  }
  if (err instanceof Error) {
    const mapped = ERROR_MAP[err.message];
    if (mapped) {
      return res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
    }
    // Mongo duplicate key (11000)
    const mongoErr = err as { code?: number };
    if (mongoErr.code === 11000) {
      return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'Workflow version conflict' } });
    }
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}

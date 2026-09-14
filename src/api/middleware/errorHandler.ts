import type { Request, Response, NextFunction } from 'express';

const ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  INVALID_REQUEST: { status: 400, code: 'INVALID_REQUEST', message: 'Invalid request' },
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
  EXECUTION_NOT_FOUND: { status: 404, code: 'EXECUTION_NOT_FOUND', message: 'Execution was not found' },
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

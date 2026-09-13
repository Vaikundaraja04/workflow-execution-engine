import type { Request, Response, NextFunction } from 'express';

const ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  INVALID_REQUEST: { status: 400, code: 'INVALID_REQUEST', message: 'Invalid request' },
  INVALID_JSON: { status: 400, code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
  INVALID_WORKFLOW_ID: { status: 400, code: 'INVALID_WORKFLOW_ID', message: 'Invalid workflow ID' },
  WORKFLOW_NOT_FOUND: { status: 404, code: 'WORKFLOW_NOT_FOUND', message: 'Workflow was not found' },
  VERSION_CONFLICT: { status: 409, code: 'VERSION_CONFLICT', message: 'Workflow version conflict' },
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

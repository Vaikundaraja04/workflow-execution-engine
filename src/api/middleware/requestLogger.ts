import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../../observability/logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

const MAX_REQUEST_ID_LENGTH = 128;
const OBJECT_ID_PATTERN = '[0-9a-fA-F]{24}';
const EXECUTION_PATH_PATTERN = new RegExp('/(?:analytics/)?executions/(' + OBJECT_ID_PATTERN + ')');
const WORKFLOW_PATH_PATTERN = new RegExp('/(?:analytics/)?workflows/(' + OBJECT_ID_PATTERN + ')');

type RequestWithContext = Request & {
  requestId?: string;
  user?: { userId?: string };
  workspaceContext?: { workspaceId?: string };
};

export function getRequestId(req: Request): string | undefined {
  return (req as RequestWithContext).requestId;
}

export function requestPath(req: Request): string {
  return req.originalUrl.split('?')[0] ?? req.path;
}

export function requestContextFields(req: Request): Record<string, string> {
  const context = req as RequestWithContext;
  const fields: Record<string, string> = {};
  if (context.requestId) fields.requestId = context.requestId;
  if (context.user?.userId) fields.userId = context.user.userId;
  if (context.workspaceContext?.workspaceId) fields.workspaceId = context.workspaceContext.workspaceId;

  const path = requestPath(req);
  const executionMatch = EXECUTION_PATH_PATTERN.exec(path);
  const workflowMatch = WORKFLOW_PATH_PATTERN.exec(path);
  if (executionMatch?.[1]) fields.executionId = executionMatch[1];
  if (workflowMatch?.[1]) fields.workflowId = workflowMatch[1];
  return fields;
}

export function requestLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers[REQUEST_ID_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    const requestId = provided && provided.trim().length > 0
      ? provided.trim().slice(0, MAX_REQUEST_ID_LENGTH)
      : randomUUID();

    (req as RequestWithContext).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const elapsedNs = Number(process.hrtime.bigint() - startedAt);
      logger.info('http_request', {
        ...requestContextFields(req),
        method: req.method,
        path: requestPath(req),
        status: res.statusCode,
        durationMs: Math.round((elapsedNs / 1_000_000) * 1000) / 1000,
      });
    });

    next();
  };
}
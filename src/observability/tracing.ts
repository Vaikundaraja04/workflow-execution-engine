import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function tracingMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Extract W3C Trace Context (traceparent) or generate new
    const traceparentHeader = req.headers['traceparent'];
    const traceparent = Array.isArray(traceparentHeader)
      ? traceparentHeader[0]
      : traceparentHeader;
    let traceId: string;
    let parentSpanId: string | undefined;

    if (traceparent && typeof traceparent === 'string') {
      const parts = traceparent.split('-');
      if (parts.length === 4 && parts[1]) {
        traceId = parts[1];
        parentSpanId = parts[2];
      } else {
        traceId = generateTraceId();
      }
    } else {
      traceId = generateTraceId();
    }

    const spanId = generateSpanId();
    (req as any).trace = {
      traceId,
      spanId,
      parentSpanId,
      serviceName,
    };

    // Propagate traceparent to downstream response
    const newTraceparent = `00-${traceId}-${spanId}-01`;
    res.setHeader('traceparent', newTraceparent);
    res.setHeader('X-Trace-Id', traceId);

    next();
  };
}

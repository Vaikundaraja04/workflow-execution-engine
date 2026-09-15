import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const CORS_ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
export const CORS_ALLOWED_HEADERS = 'Authorization,Content-Type,X-Request-Id';
export const CORS_MAX_AGE_SECONDS = '600';

export function createCorsMiddleware(allowedOrigins: readonly string[] = []): RequestHandler {
  const allowed = new Set(allowedOrigins.map(origin => origin.trim()).filter(origin => origin.length > 0));

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const originAllowed = typeof origin === 'string' && allowed.has(origin);

    if (originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', CORS_MAX_AGE_SECONDS);
    }

    if (req.method === 'OPTIONS' && originAllowed) {
      res.status(204).end();
      return;
    }

    next();
  };
}
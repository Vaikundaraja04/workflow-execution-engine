import { Router } from 'express';
import type { Request, Response } from 'express';

/**
 * Minimal liveness/example route. No auth, no database — the "door" pattern
 * in its simplest form: GET /api/ping -> { message: 'pong', ... }.
 */
export function createPingRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({ message: 'pong', timestamp: new Date().toISOString() });
  });

  return router;
}

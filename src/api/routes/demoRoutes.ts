import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { AuthConfig } from '../../auth/jwt.service.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { resolveTargetWorkspace } from '../middleware/requirePermission.js';
import { demoWorkspaceService } from '../../services/demoWorkspaceService.js';
import { demoScenarioService } from '../../services/demoScenarioService.js';

const resetSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

export function createDemoRouter(
  config: AuthConfig,
  requireAuth: RequestHandler,
  createLimiter?: RequestHandler,
): Router {
  const router = Router();

  router.post(
    '/create',
    ...(createLimiter ? [createLimiter] : []),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await demoWorkspaceService.create(config, {
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? undefined,
        });
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // Phase 16.3 - Scenario demos: curated industry walkthroughs backed by the
  // solution catalog. Listing is public; starting provisions a sandbox.
  router.get('/scenarios', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ scenarios: await demoScenarioService.listScenarios() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/scenarios/:scenarioId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await demoScenarioService.getScenario(req.params.scenarioId as string));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/start/:scenarioId',
    ...(createLimiter ? [createLimiter] : []),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await demoScenarioService.startScenario(
          req.params.scenarioId as string,
          config,
          { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined },
        );
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/reset',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = resetSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const userId = getAuthUser(req).userId;
        const workspaceId = parsed.data.workspaceId
          ?? await resolveTargetWorkspace(req, {}, userId);
        const result = await demoWorkspaceService.reset(workspaceId, userId, {
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? undefined,
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

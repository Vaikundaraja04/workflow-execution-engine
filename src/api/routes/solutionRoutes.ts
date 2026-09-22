import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { solutionTemplateService } from '../../services/solutionTemplateService.js';
import { requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { requireActiveTenant, requireEntitlement } from '../middleware/requireEntitlement.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { isProductPackageId } from '../../models/ProductPlanModel.js';
import type { ProductPackageId } from '../../models/ProductPlanModel.js';

const installBodySchema = z.object({
  installWorkflows: z.boolean().optional(),
  installAgents: z.boolean().optional(),
  registerMarketplaceTemplates: z.boolean().optional(),
}).strict();

export function createSolutionRoutes(requireAuth: RequestHandler): Router {
  const router = Router();

  // Public solution catalog backing the marketing solutions page.
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const params: { industry?: string | undefined; packageId?: ProductPackageId | undefined } = {};
      if (typeof _req.query.industry === 'string') params.industry = _req.query.industry;
      if (typeof _req.query.package === 'string') {
        if (!isProductPackageId(_req.query.package)) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid package query parameter' } });
        }
        params.packageId = _req.query.package;
      }
      const solutions = solutionTemplateService.listSolutions(params);
      res.json({ solutions });
    } catch (error) {
      next(error);
    }
  });

  // A single solution's full definition (solutions detail page).
  router.get('/:solutionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(solutionTemplateService.getSolution(req.params.solutionId as string));
    } catch (error) {
      next(error);
    }
  });
  // Authenticated workspaces can install a solution package into their workspace.
  router.post('/:solutionId/install', requireAuth, requireActiveTenant(), requireMembership(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = installBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const ctx = getWorkspaceContext(req);
        const result = await solutionTemplateService.install(req.params.solutionId as string, {
          workspaceId: ctx.workspaceId,
          userId: getAuthUser(req).userId,
          ...(parsed.data.installWorkflows !== undefined ? { installWorkflows: parsed.data.installWorkflows } : {}),
          ...(parsed.data.installAgents !== undefined ? { installAgents: parsed.data.installAgents } : {}),
          ...(parsed.data.registerMarketplaceTemplates !== undefined ? { registerMarketplaceTemplates: parsed.data.registerMarketplaceTemplates } : {}),
        });
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    });

  return router;
}

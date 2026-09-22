import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { isPlatformAdminEmail } from '../middleware/platformAdmin.js';
import { authorizeRequest, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { customerSuccessIntelligenceService } from '../../services/customerSuccessIntelligenceService.js';

/**
 * Phase 18.2 - Customer success intelligence API.
 *
 * Administrators read the portfolio or one workspace by id; a member reads their
 * own workspace only. A foreign workspace resolves to 404.
 */

function isAdmin(req: Request): boolean {
  try {
    return isPlatformAdminEmail(getAuthUser(req).email);
  } catch {
    return false;
  }
}

async function memberWorkspaceId(req: Request): Promise<string> {
  const outcome = await authorizeRequest(req, {});
  if (outcome === 'allow') return getWorkspaceContext(req).workspaceId;
  if (outcome === 'forbidden') throw new Error('FORBIDDEN');
  if (outcome === 'denied') throw new Error('PERMISSION_DENIED');
  throw new Error('WORKSPACE_NOT_FOUND');
}

function numberQuery(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function createCustomerSuccessIntelligenceRouter(): Router {
  const router = Router();

  router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestedWorkspace = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      if (isAdmin(req)) {
        if (requestedWorkspace !== undefined) {
          res.json({ data: await customerSuccessIntelligenceService.evaluate(requestedWorkspace) });
          return;
        }
        const limit = numberQuery(req.query.limit);
        const status = req.query.status === 'HEALTHY' || req.query.status === 'WARNING' || req.query.status === 'CRITICAL'
          ? req.query.status
          : undefined;
        res.json({
          data: await customerSuccessIntelligenceService.portfolio({
            ...(limit !== undefined ? { limit } : {}),
            ...(status !== undefined ? { status } : {}),
          }),
        });
        return;
      }

      const own = await memberWorkspaceId(req);
      if (requestedWorkspace !== undefined && requestedWorkspace !== own) {
        throw new Error('WORKSPACE_NOT_FOUND');
      }
      res.json({ data: await customerSuccessIntelligenceService.evaluate(own) });
    } catch (err) { next(err); }
  });

  return router;
}
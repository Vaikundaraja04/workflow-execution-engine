import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { isPlatformAdminEmail } from '../middleware/platformAdmin.js';
import { authorizeRequest, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { enterpriseComplianceService } from '../../services/enterpriseComplianceService.js';

/**
 * Phase 18.5 - Compliance center API.
 *
 * Administrators read the platform posture or one workspace; a member reads
 * their own workspace only. A foreign workspace resolves to 404.
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

export function createEnterpriseComplianceRouter(): Router {
  const router = Router();

  router.get('/center', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestedWorkspace = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      const days = numberQuery(req.query.days);
      const actorUserId = getAuthUser(req).userId;
      let workspaceId: string | undefined;
      if (isAdmin(req)) {
        workspaceId = requestedWorkspace;
      } else {
        const own = await memberWorkspaceId(req);
        if (requestedWorkspace !== undefined && requestedWorkspace !== own) {
          throw new Error('WORKSPACE_NOT_FOUND');
        }
        workspaceId = own;
      }

      const report = await enterpriseComplianceService.report({
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(days !== undefined ? { days } : {}),
        actorUserId,
      });
      res.json({ data: report });
    } catch (err) { next(err); }
  });

  return router;
}
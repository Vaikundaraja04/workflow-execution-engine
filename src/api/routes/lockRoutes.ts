import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createRequireAuth, getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { lockService } from '../../services/lockService.js';

export function createLockRoutes(requireAuth: ReturnType<typeof createRequireAuth>): Router {
  const router = Router();

  // POST /api/v1/locks/workflows/:workflowId/acquire
  router.post(
    '/workflows/:workflowId/acquire',
    requireAuth,
    requirePermission('WORKFLOW_UPDATE', { workflowParam: 'workflowId' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const authUser = getAuthUser(req);
        const workflowId = req.params.workflowId as string;
        const { ttlSeconds } = req.body as { ttlSeconds?: number };

        const result = await lockService.acquireLock(
          workflowId,
          workspaceContext.workspaceId,
          workspaceContext.userId,
          authUser.email,
          authUser.email.split('@')[0],
          ttlSeconds,
        );

        if (result.acquired) {
          res.json({ acquired: true, lock: result.lock });
        } else {
          res.status(409).json({ acquired: false, conflict: result.conflict });
        }
      } catch (error) {
        next(error);
      }
    },
  );

  // PUT /api/v1/locks/workflows/:workflowId/heartbeat
  router.put(
    '/workflows/:workflowId/heartbeat',
    requireAuth,
    requirePermission('WORKFLOW_UPDATE', { workflowParam: 'workflowId' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const workflowId = req.params.workflowId as string;
        const { lockToken, ttlSeconds } = req.body as {
          lockToken: string;
          ttlSeconds?: number;
        };

        if (!lockToken) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'lockToken is required' } });
          return;
        }

        const lockInfo = await lockService.heartbeat(
          workflowId,
          workspaceContext.workspaceId,
          workspaceContext.userId,
          lockToken,
          ttlSeconds,
        );

        if (lockInfo) {
          res.json({ acquired: true, lock: lockInfo });
        } else {
          res.status(404).json({ acquired: false, error: 'Lock not found' });
        }
      } catch (error) {
        next(error);
      }
    },
  );

  // DELETE /api/v1/locks/workflows/:workflowId/release
  router.delete(
    '/workflows/:workflowId/release',
    requireAuth,
    requirePermission('WORKFLOW_UPDATE', { workflowParam: 'workflowId' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const workflowId = req.params.workflowId as string;
        const { lockToken, force } = req.body as {
          lockToken?: string;
          force?: boolean;
        };

        const success = await lockService.releaseLock(
          workflowId,
          workspaceContext.workspaceId,
          workspaceContext.userId,
          lockToken,
          !!force,
        );

        if (success) {
          res.status(204).send();
        } else {
          res.status(404).json({ error: { code: 'LOCK_NOT_FOUND', message: 'Lock not found' } });
        }
      } catch (error) {
        const typedError = error as Error;
        if (typedError.message === 'CANNOT_RELEASE_OTHERS_LOCK') {
          next(new Error('FORBIDDEN'));
        } else if (typedError.message === 'PERMISSION_DENIED') {
          next(new Error('FORBIDDEN'));
        } else if (typedError.message === 'INVALID_LOCK_TOKEN') {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid lock token' } });
          return;
        } else {
          next(error);
        }
      }
    },
  );

  // GET /api/v1/locks/workflows/:workflowId
  router.get(
    '/workflows/:workflowId',
    requireAuth,
    requirePermission('WORKFLOW_READ', { workflowParam: 'workflowId' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const workflowId = req.params.workflowId as string;

        const lockInfo = await lockService.getLock(
          workflowId,
          workspaceContext.userId,
        );

        if (lockInfo) {
          res.json(lockInfo);
        } else {
          res.status(404).json({ error: { code: 'LOCK_NOT_FOUND', message: 'Lock not found' } });
        }
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export default createLockRoutes;

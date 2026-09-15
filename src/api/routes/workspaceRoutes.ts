import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { requireMembership } from '../middleware/requirePermission.js';
import { createMemberRouter } from './memberRoutes.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import {
  createWorkspace,
  getWorkspace,
  listUserWorkspaces,
  updateWorkspace,
} from '../../services/workspaceService.js';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().max(280).optional(),
}).strict();

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(280).optional(),
}).strict().refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required',
});

function getRouteId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('INVALID_WORKSPACE_ID');
  return id;
}

export function createWorkspaceRouter(): Router {
  const router = Router();

  const requireWorkspaceMembership = requireMembership({ workspaceParam: 'id' });

  router.use('/:id/members', createMemberRouter());

  router.post('/', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createWorkspaceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
      }
      const workspace = await createWorkspace(getAuthUser(req).userId, parsed.data);
      res.status(201).json(workspace);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);
  router.get('/', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaces = await listUserWorkspaces(getAuthUser(req).userId);
      res.json(workspaces);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.get('/:id', requireWorkspaceMembership, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await getWorkspace(getRouteId(req), getAuthUser(req).userId);
      res.json(workspace);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.patch('/:id', requireWorkspaceMembership, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateWorkspaceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
      }
      const workspace = await updateWorkspace(getRouteId(req), getAuthUser(req).userId, parsed.data);
      res.json(workspace);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  return router;
}

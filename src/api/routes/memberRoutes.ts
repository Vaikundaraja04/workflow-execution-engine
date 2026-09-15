import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  acceptInvitation,
  assertValidWorkspaceId,
  inviteMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from '../../services/memberService.js';

const roleSchema = z.enum(['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  role: roleSchema.optional(),
}).strict().refine((data) => data.email !== undefined || data.userId !== undefined, {
  message: 'email or userId is required',
});

const updateRoleSchema = z.object({ role: roleSchema }).strict();

function workspaceIdOf(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('INVALID_WORKSPACE_ID');
  assertValidWorkspaceId(id);
  return id;
}

function memberReferenceOf(req: Request): string {
  const reference = req.params.memberId;
  if (typeof reference !== 'string' || reference.length === 0) throw new Error('MEMBER_NOT_FOUND');
  return reference;
}

function sendInvalidRequest(res: Response) {
  res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
}

export function createMemberRouter(): Router {
  const router = Router({ mergeParams: true });
  const requireMemberManage = requirePermission('MEMBER_MANAGE', { workspaceParam: 'id' });

  router.post('/invite', requireMemberManage, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        sendInvalidRequest(res);
        return;
      }
      const member = await inviteMember(workspaceIdOf(req), getAuthUser(req).userId, parsed.data);
      res.status(201).json(member);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.post('/accept', (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const member = await acceptInvitation(workspaceIdOf(req), getAuthUser(req).userId);
      res.json(member);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.get('/', requireMemberManage, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await listMembers(workspaceIdOf(req));
      res.json(members);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.patch('/:memberId', requireMemberManage, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        sendInvalidRequest(res);
        return;
      }
      const member = await updateMemberRole(
        workspaceIdOf(req),
        getAuthUser(req).userId,
        memberReferenceOf(req),
        parsed.data.role,
      );
      res.json(member);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.delete('/:memberId', requireMemberManage, (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const member = await removeMember(workspaceIdOf(req), getAuthUser(req).userId, memberReferenceOf(req));
      res.json(member);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  return router;
}

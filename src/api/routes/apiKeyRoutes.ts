import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CreateAPIKeySchema, UpdateAPIKeySchema } from '../../schemas/apiKeySchema.js';
import {
  createAPIKey,
  listAPIKeys,
  getAPIKey,
  updateAPIKey,
  revokeAPIKey,
  rotateAPIKey,
  filterPermissionsForRole,
} from '../../services/apiKeyService.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { createAuditLog } from '../../services/auditService.js';
import type { Permission } from '../../auth/permissions.js';
import type { RequestHandler } from 'express';

const requireMemberManage = requirePermission('MEMBER_MANAGE');

function getRouteId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new Error('INVALID_API_KEY_ID');
  return id;
}

export function createAPIKeyRouter(): Router {
  const router = Router();

  router.post(
    '/keys',
    getAuthUser as RequestHandler,
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = CreateAPIKeySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;
        const role = getWorkspaceContext(req).role;
        const permissions = filterPermissionsForRole(parsed.data.permissions, role);
        const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined;
        const created = await createAPIKey(workspaceId, userId, parsed.data.name, permissions, expiresAt);
        await createAuditLog({
          action: 'API_KEY_CREATED',
          userId,
          workspaceId,
          resource: 'api_key',
          resourceId: created.key.id,
          metadata: { name: parsed.data.name, permissions },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/keys',
    getAuthUser as RequestHandler,
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const keys = await listAPIKeys(workspaceId);
        return res.json(keys);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/keys/:id',
    getAuthUser as RequestHandler,
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const key = await getAPIKey(id, workspaceId);
        return res.json(key);
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/keys/:id',
    getAuthUser as RequestHandler,
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const parsed = UpdateAPIKeySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const updates: { name?: string; permissions?: Permission[]; expiresAt?: Date | null } = {};
        if (parsed.data.name !== undefined) updates.name = parsed.data.name;
        if (parsed.data.permissions !== undefined) updates.permissions = parsed.data.permissions;
        if (parsed.data.expiresAt !== undefined) {
          updates.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
        }
        const key = await updateAPIKey(id, workspaceId, updates);
        return res.json(key);
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/keys/:id',
    getAuthUser as RequestHandler,
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;
        await revokeAPIKey(id, workspaceId, userId);
        await createAuditLog({
          action: 'API_KEY_REVOKED',
          userId,
          workspaceId,
          resource: 'api_key',
          resourceId: id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/keys/:id/rotate',
    getAuthUser as RequestHandler,
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;
        const rotated = await rotateAPIKey(id, workspaceId, userId);
        await createAuditLog({
          action: 'API_KEY_ROTATED',
          userId,
          workspaceId,
          resource: 'api_key',
          resourceId: rotated.key.id,
          metadata: { previousKeyId: id },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.status(201).json(rotated);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

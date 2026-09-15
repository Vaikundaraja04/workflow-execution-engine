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
import { APIKeyModel } from '../../models/APIKeyModel.js';

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

  const UpdateRateLimitSchema = z.object({
    requestsPerMinute: z.number().int().positive().max(10000).optional(),
    executionsPerHour: z.number().int().positive().max(100000).optional(),
  }).strict().refine(data => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

  router.patch(
    '/keys/:id/limits',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const parsed = UpdateRateLimitSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        // Get current key to capture old limits
        const keyDoc = await APIKeyModel.findById(id);
        if (!keyDoc) {
          throw new Error('API_KEY_NOT_FOUND');
        }
        if (keyDoc.workspaceId.toString() !== workspaceId) {
          throw new Error('FORBIDDEN');
        }
        const currentKey = {
          id: keyDoc._id.toString(),
          name: keyDoc.name,
          keyPrefix: keyDoc.keyPrefix,
          status: keyDoc.status,
          permissions: keyDoc.permissions,
          lastUsedAt: keyDoc.lastUsedAt?.toISOString(),
          expiresAt: keyDoc.expiresAt?.toISOString(),
          createdBy: keyDoc.createdBy.toString(),
          revokedAt: keyDoc.revokedAt?.toISOString(),
          rateLimit: keyDoc.rateLimit
            ? {
                requestsPerMinute: keyDoc.rateLimit.requestsPerMinute,
                executionsPerHour: keyDoc.rateLimit.executionsPerHour,
              }
            : {
                requestsPerMinute: 1000,
                executionsPerHour: 5000,
              },
          createdAt: keyDoc.createdAt.toISOString(),
          updatedAt: keyDoc.updatedAt.toISOString(),
        };

        // Update rate limits
        const rateLimitUpdates: { requestsPerMinute?: number; executionsPerHour?: number } = {};
        if (parsed.data.requestsPerMinute !== undefined) {
          rateLimitUpdates.requestsPerMinute = parsed.data.requestsPerMinute;
        }
        if (parsed.data.executionsPerHour !== undefined) {
          rateLimitUpdates.executionsPerHour = parsed.data.executionsPerHour;
        }

        const key = await updateAPIKey(id, workspaceId, {
          rateLimit: rateLimitUpdates,
        });

        await createAuditLog({
          action: 'API_KEY_RATE_LIMIT_UPDATED',
          userId,
          workspaceId,
          resource: 'api_key',
          resourceId: id,
          metadata: {
            apiKeyId: id,
            oldLimit: currentKey.rateLimit,
            newLimit: key.rateLimit,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        return res.json(key);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../../models/WebhookModel.js';
import {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  getWebhookDelivery,
  updateWebhookDeliveryStatus,
} from '../../services/webhookService.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { createAuditLog } from '../../services/auditService.js';
import type { WebhookQueue } from '../../queues/webhookQueue.js';
import { createWebhookJobId } from '../../queues/webhookQueue.js';

const requireMemberManage = requirePermission('MEMBER_MANAGE');

const CreateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
}).strict();

const UpdateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(120).optional().or(z.literal(undefined)),
  url: z.string().url().max(2048).optional().or(z.literal(undefined)),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional().or(z.literal(undefined)),
  status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED']).optional().or(z.literal(undefined)),
}).strict().refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required',
});

function getRouteId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') {
    throw new Error('INVALID_WEBHOOK_ID');
  }
  return id;
}

function getDeliveryId(req: Request): string {
  const id = req.params.deliveryId;
  if (typeof id !== 'string') {
    throw new Error('INVALID_WEBHOOK_DELIVERY_ID');
  }
  return id;
}

export function createWebhookRouter(webhookQueue: WebhookQueue): Router {
  const router = Router();

  // Create webhook
  router.post(
    '/',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = CreateWebhookSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'Invalid request body' },
          });
        }

        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        const { webhook, secret } = await createWebhook(workspaceId, userId, parsed.data);

        res.status(201).json({
          id: webhook._id.toString(),
          name: webhook.name,
          url: webhook.url,
          events: webhook.events,
          status: webhook.status,
          secret, // Return secret only on creation
          createdAt: webhook.createdAt.toISOString(),
          updatedAt: webhook.updatedAt.toISOString(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // List webhooks
  router.get(
    '/',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const webhooks = await listWebhooks(workspaceId);

        res.json(
          webhooks.map(webhook => ({
            id: webhook._id.toString(),
            name: webhook.name,
            url: webhook.url,
            events: webhook.events,
            status: webhook.status,
            createdAt: webhook.createdAt.toISOString(),
            updatedAt: webhook.updatedAt.toISOString(),
          })),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // Get webhook
  router.get(
    '/:id',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const webhook = await getWebhook(id, workspaceId);

        res.json({
          id: webhook._id.toString(),
          name: webhook.name,
          url: webhook.url,
          events: webhook.events,
          status: webhook.status,
          createdAt: webhook.createdAt.toISOString(),
          updatedAt: webhook.updatedAt.toISOString(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // Update webhook
  router.patch(
    '/:id',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const parsed = UpdateWebhookSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'Invalid request body' },
          });
        }

        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        const webhook = await updateWebhook(id, workspaceId, userId, parsed.data);

        res.json({
          id: webhook._id.toString(),
          name: webhook.name,
          url: webhook.url,
          events: webhook.events,
          status: webhook.status,
          createdAt: webhook.createdAt.toISOString(),
          updatedAt: webhook.updatedAt.toISOString(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // Delete webhook (soft delete)
  router.delete(
    '/:id',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        await deleteWebhook(id, workspaceId, userId);

        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  // List webhook deliveries
  router.get(
    '/:id/deliveries',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = getRouteId(req);
        const workspaceId = getWorkspaceContext(req).workspaceId;

        // Verify webhook exists in this workspace
        await getWebhook(id, workspaceId);

        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
        const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

        const deliveries = await listWebhookDeliveries(id, workspaceId, {
          limit: Math.min(limit, 100),
          offset,
        });

        res.json(
          deliveries.map(delivery => ({
            id: delivery._id.toString(),
            webhookId: delivery.webhookId.toString(),
            event: delivery.event,
            status: delivery.status,
            attempts: delivery.attempts,
            maxAttempts: delivery.maxAttempts,
            responseCode: delivery.responseCode,
            durationMs: delivery.durationMs,
            createdAt: delivery.createdAt.toISOString(),
            deliveredAt: delivery.deliveredAt?.toISOString(),
            nextRetryAt: delivery.nextRetryAt?.toISOString(),
          })),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // Retry webhook delivery
  router.post(
    '/:id/deliveries/:deliveryId/retry',
    requireMemberManage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const webhookId = getRouteId(req);
        const deliveryId = getDeliveryId(req);
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const userId = getAuthUser(req).userId;

        // Verify webhook exists in this workspace
        await getWebhook(webhookId, workspaceId);

        // Get the delivery
        const delivery = await getWebhookDelivery(deliveryId, workspaceId);

        // Verify it belongs to this webhook
        if (delivery.webhookId.toString() !== webhookId) {
          return res.status(404).json({
            error: { code: 'WEBHOOK_DELIVERY_NOT_FOUND', message: 'Webhook delivery not found' },
          });
        }

        // Only retry failed deliveries
        if (delivery.status !== 'FAILED') {
          return res.status(409).json({
            error: { code: 'WEBHOOK_DELIVERY_NOT_FAILED', message: 'Only failed deliveries can be retried' },
          });
        }

        // Reset the delivery status and enqueue again
        await updateWebhookDeliveryStatus(deliveryId, workspaceId, {
          status: 'PENDING',
          attempts: 0,
          nextRetryAt: undefined,
        });

        // Enqueue the delivery job
        await webhookQueue.enqueue(
          { deliveryId },
          {
            jobId: createWebhookJobId(deliveryId),
            attempts: delivery.maxAttempts,
            backoffMs: 10000,
          },
        );

        await createAuditLog({
          action: 'WEBHOOK_DELIVERY_RETRIED',
          userId,
          workspaceId,
          resource: 'webhook_delivery',
          resourceId: deliveryId,
          metadata: {
            webhookId,
            deliveryId,
            event: delivery.event,
          },
        });

        res.status(202).json({
          message: 'Webhook delivery retry initiated',
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

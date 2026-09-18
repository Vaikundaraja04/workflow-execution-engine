import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createRequireAuth } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { notificationService } from '../../services/notificationService.js';

export function createNotificationRoutes(requireAuth: ReturnType<typeof createRequireAuth>): Router {
  const router = Router();

  // GET /api/v1/notifications
  router.get(
    '/',
    requireAuth,
    requirePermission('COLLABORATION_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const { limit, offset, isRead } = req.query;

        const result = await notificationService.getUserNotifications(
          workspaceContext.userId,
          workspaceContext.workspaceId,
          {
            limit: limit ? parseInt(limit as string, 10) : undefined,
            offset: offset ? parseInt(offset as string, 10) : undefined,
            isRead: isRead === 'true' ? true : isRead === 'false' ? false : undefined,
          },
        );

        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // GET /api/v1/notifications/unread-count
  router.get(
    '/unread-count',
    requireAuth,
    requirePermission('COLLABORATION_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const count = await notificationService.getUnreadCount(
          workspaceContext.userId,
          workspaceContext.workspaceId,
        );

        res.json({ count });
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /api/v1/notifications/:notificationId/read
  router.post(
    '/:notificationId/read',
    requireAuth,
    requirePermission('COLLABORATION_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const notificationId = req.params.notificationId as string;

        const notification = await notificationService.markAsRead(
          notificationId,
          workspaceContext.userId,
        );

        if (!notification) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
          return;
        }

        res.json(notification);
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /api/v1/notifications/read-all
  router.post(
    '/read-all',
    requireAuth,
    requirePermission('COLLABORATION_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const count = await notificationService.markAllAsRead(
          workspaceContext.userId,
          workspaceContext.workspaceId,
        );

        res.json({ count });
      } catch (error) {
        next(error);
      }
    },
  );

  // DELETE /api/v1/notifications/:notificationId
  router.delete(
    '/:notificationId',
    requireAuth,
    requirePermission('COLLABORATION_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const notificationId = req.params.notificationId as string;

        const deleted = await notificationService.deleteNotification(
          notificationId,
          workspaceContext.userId,
        );

        if (!deleted) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
          return;
        }

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export default createNotificationRoutes;

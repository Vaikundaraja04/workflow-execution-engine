import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createRequireAuth } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { commentService } from '../../services/commentService.js';

export function createCommentRoutes(requireAuth: ReturnType<typeof createRequireAuth>): Router {
  const router = Router();

  // GET /api/v1/comments/workflow/:workflowId
  router.get(
    '/workflow/:workflowId',
    requireAuth,
    requirePermission('COLLABORATION_READ', { workflowParam: 'workflowId' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workflowId } = req.params;
        const workspaceContext = getWorkspaceContext(req);
        const { limit, offset, status, includeReplies } = req.query;

        const result = await commentService.getWorkflowComments(
          workflowId as string,
          workspaceContext.workspaceId,
          workspaceContext.userId,
          {
            limit: limit ? parseInt(limit as string, 10) : undefined,
            offset: offset ? parseInt(offset as string, 10) : undefined,
            status: status === 'OPEN' || status === 'RESOLVED' ? status : undefined,
            includeReplies: includeReplies === 'true',
          },
        );

        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /api/v1/comments
  router.post(
    '/',
    requireAuth,
    requirePermission('COLLABORATION_COMMENT'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceContext = getWorkspaceContext(req);
        const dto = req.body as {
          workflowId: string;
          content: string;
          nodeId?: string;
          parentCommentId?: string;
          mentions?: string[];
        };

        if (!dto.workflowId || !dto.content) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'workflowId and content are required' } });
          return;
        }

        const comment = await commentService.createComment(
          workspaceContext.workspaceId,
          workspaceContext.userId,
          dto,
        );

        res.status(201).json(comment);
      } catch (error) {
        next(error);
      }
    },
  );

  // GET /api/v1/comments/:commentId
  router.get(
    '/:commentId',
    requireAuth,
    requirePermission('COLLABORATION_READ'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { commentId } = req.params;
        const workspaceContext = getWorkspaceContext(req);

        const comment = await commentService.getCommentById(
          commentId as string,
          workspaceContext.workspaceId,
          workspaceContext.userId,
        );

        if (!comment) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } });
          return;
        }

        res.json(comment);
      } catch (error) {
        next(error);
      }
    },
  );

  // PUT /api/v1/comments/:commentId
  router.put(
    '/:commentId',
    requireAuth,
    requirePermission('COLLABORATION_COMMENT'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { commentId } = req.params;
        const workspaceContext = getWorkspaceContext(req);
        const dto = req.body as {
          content?: string;
          status?: 'OPEN' | 'RESOLVED';
        };

        const comment = await commentService.updateComment(
          commentId as string,
          workspaceContext.workspaceId,
          workspaceContext.userId,
          dto,
        );

        res.json(comment);
      } catch (error) {
        next(error);
      }
    },
  );

  // DELETE /api/v1/comments/:commentId
  router.delete(
    '/:commentId',
    requireAuth,
    requirePermission('COLLABORATION_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { commentId } = req.params;
        const workspaceContext = getWorkspaceContext(req);

        await commentService.deleteComment(
          commentId as string,
          workspaceContext.workspaceId,
          workspaceContext.userId,
        );

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export default createCommentRoutes;

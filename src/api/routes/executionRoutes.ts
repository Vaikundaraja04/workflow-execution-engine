import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { CreateExecutionRequestSchema } from '../../schemas/executionSchema.js';
import type { ExecutionQueue } from '../../queues/executionQueue.js';
import type { ExecutionCreationOptions } from '../../services/executionService.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { createAuditLog } from '../../services/auditService.js';
import {
  createWorkflowExecution,
  getWorkflowExecution,
  listWorkflowExecutions,
  toWorkflowExecutionView,
} from '../../services/executionService.js';

function getRouteParameter(req: Request, name: string, errorCode: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new Error(errorCode);
  return value;
}

const requireExecutionRead = requirePermission('WORKFLOW_READ', { executionParam: 'executionId' });
const requireWorkflowRead = requirePermission('WORKFLOW_READ', { workflowParam: 'workflowId' });
const requireWorkflowExecute = requirePermission('WORKFLOW_EXECUTE', { workflowParam: 'workflowId' });

export function createExecutionRouter(
  queue: ExecutionQueue,
  creationOptions: ExecutionCreationOptions,
  requireAuth: RequestHandler,
) {
  const router = Router();

  router.post(
    '/workflows/:workflowId/executions',
    requireAuth,
    requireWorkflowExecute,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workflowId = getRouteParameter(req, 'workflowId', 'INVALID_WORKFLOW_ID');
        const parsed = CreateExecutionRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'Invalid request body' },
          });
        }

        const workspaceId = getWorkspaceContext(req).workspaceId;
        const created = await createWorkflowExecution(
          queue,
          workflowId,
          parsed.data,
          getAuthUser(req).userId,
          workspaceId,
          creationOptions,
        );
        if (!created.replayed) {
          await createAuditLog({
            action: 'EXECUTION_STARTED',
            userId: getAuthUser(req).userId,
            workspaceId,
            resource: 'execution',
            resourceId: created.execution._id.toString(),
            metadata: { workflowId },
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
          });
        }
        return res.status(202).json({
          ...toWorkflowExecutionView(created.execution),
          replayed: created.replayed,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/executions/:executionId',
    requireAuth,
    requireExecutionRead,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const execution = await getWorkflowExecution(executionId, getAuthUser(req).userId, workspaceId);
        return res.json(toWorkflowExecutionView(execution));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/workflows/:workflowId/executions',
    requireAuth,
    requireWorkflowRead,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workflowId = getRouteParameter(req, 'workflowId', 'INVALID_WORKFLOW_ID');
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const executions = await listWorkflowExecutions(workflowId, getAuthUser(req).userId, workspaceId);
        return res.json(executions.map(toWorkflowExecutionView));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

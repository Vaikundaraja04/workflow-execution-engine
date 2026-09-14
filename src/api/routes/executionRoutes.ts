import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { CreateExecutionRequestSchema } from '../../schemas/executionSchema.js';
import type { ExecutionQueue } from '../../queues/executionQueue.js';
import type { ExecutionCreationOptions } from '../../services/executionService.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
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

export function createExecutionRouter(
  queue: ExecutionQueue,
  creationOptions: ExecutionCreationOptions,
  requireAuth: RequestHandler,
) {
  const router = Router();

  router.post(
    '/workflows/:workflowId/executions',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workflowId = getRouteParameter(req, 'workflowId', 'INVALID_WORKFLOW_ID');
        const parsed = CreateExecutionRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'Invalid request body' },
          });
        }

        const created = await createWorkflowExecution(
          queue,
          workflowId,
          parsed.data,
          getAuthUser(req).userId,
          creationOptions,
        );
        if (!created.replayed) {
          await createAuditLog({
            action: 'EXECUTION_STARTED',
            userId: getAuthUser(req).userId,
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
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
        const execution = await getWorkflowExecution(executionId, getAuthUser(req).userId);
        return res.json(toWorkflowExecutionView(execution));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/workflows/:workflowId/executions',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workflowId = getRouteParameter(req, 'workflowId', 'INVALID_WORKFLOW_ID');
        const executions = await listWorkflowExecutions(workflowId, getAuthUser(req).userId);
        return res.json(executions.map(toWorkflowExecutionView));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

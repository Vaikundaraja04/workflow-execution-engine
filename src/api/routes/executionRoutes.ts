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
  replayWorkflowExecution,
  cancelWorkflowExecution,
  retryWorkflowExecution,
  toWorkflowExecutionView,
} from '../../services/executionService.js';
import { listWorkflowDeadLetters, toDeadLetterView } from '../../services/deadLetterService.js';

function getRouteParameter(req: Request, name: string, errorCode: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new Error(errorCode);
  return value;
}

const requireExecutionRead = requirePermission('WORKFLOW_READ', { executionParam: 'executionId' });
const requireExecutionExecute = requirePermission('WORKFLOW_EXECUTE', { executionParam: 'executionId' });
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

  router.post(
    '/executions/:executionId/replay',
    requireAuth,
    requireExecutionExecute,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const replayed = await replayWorkflowExecution(
          queue,
          executionId,
          getAuthUser(req).userId,
          workspaceId,
          creationOptions,
        );
        await createAuditLog({
          action: 'EXECUTION_REPLAYED',
          userId: getAuthUser(req).userId,
          workspaceId,
          resource: 'execution',
          resourceId: replayed._id.toString(),
          metadata: { parentExecutionId: executionId, workflowId: replayed.workflowId.toString() },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.status(202).json(toWorkflowExecutionView(replayed));
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
    '/executions/:executionId/logs',
    requireAuth,
    requireExecutionRead,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const execution = await getWorkflowExecution(executionId, getAuthUser(req).userId, workspaceId);

        const logs: Array<{ timestamp: string; level: 'INFO' | 'WARN' | 'ERROR'; message: string }> =
          execution.statusHistory.map(event => ({
            timestamp: event.timestamp.toISOString(),
            level: event.status === 'FAILED' ? 'ERROR' : 'INFO',
            message: `Execution status changed to ${event.status}${event.attempt !== undefined ? ` (attempt ${event.attempt})` : ''}`,
          }));

        if (execution.error) {
          logs.push({
            timestamp: (execution.finishedAt ?? new Date()).toISOString(),
            level: 'ERROR',
            message: `${execution.error.code}: ${execution.error.message}`,
          });
        }

        logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return res.json(logs);
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

  router.get(
    '/workflows/:workflowId/dead-letters',
    requireAuth,
    requireWorkflowRead,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workflowId = getRouteParameter(req, 'workflowId', 'INVALID_WORKFLOW_ID');
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const deadLetters = await listWorkflowDeadLetters(workflowId, getAuthUser(req).userId, workspaceId);
        return res.json(deadLetters.map(toDeadLetterView));
      } catch (error) {
        next(error);
      }
    },
  );

  // Execution control endpoints
  router.post(
    '/executions/:executionId/cancel',
    requireAuth,
    requireExecutionExecute,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const reason = req.body.reason as string | undefined;
        const cancelled = await cancelWorkflowExecution(
          queue,
          executionId,
          getAuthUser(req).userId,
          workspaceId,
          reason,
        );
        await createAuditLog({
          action: 'EXECUTION_CANCELLED',
          userId: getAuthUser(req).userId,
          workspaceId,
          resource: 'execution',
          resourceId: executionId,
          metadata: {
            executionId,
            reason: cancelled.error?.message,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.json(toWorkflowExecutionView(cancelled));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/executions/:executionId/retry',
    requireAuth,
    requireExecutionExecute,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const executionId = getRouteParameter(req, 'executionId', 'INVALID_EXECUTION_ID');
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const parsed = CreateExecutionRequestSchema.safeParse(req.body);
        const options: ExecutionCreationOptions = {};
        if (parsed.success && parsed.data.timeoutMs !== undefined) {
          options.timeoutMs = parsed.data.timeoutMs;
        }
        const retried = await retryWorkflowExecution(
          queue,
          executionId,
          getAuthUser(req).userId,
          workspaceId,
          options,
        );
        await createAuditLog({
          action: 'EXECUTION_RETRIED',
          userId: getAuthUser(req).userId,
          workspaceId,
          resource: 'execution',
          resourceId: executionId,
          metadata: {
            executionId,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.json(toWorkflowExecutionView(retried));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

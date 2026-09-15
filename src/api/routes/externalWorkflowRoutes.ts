import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ExternalTriggerSchema } from '../../schemas/externalTriggerSchema.js';
import { createRequireAPIKey, requireAPIKeyPermission, getAPIKeyContext } from '../../auth/apiKeyAuth.middleware.js';
import { createRateLimitMiddleware } from '../../api/middleware/rateLimitMiddleware.js';
import { createWorkflowExecution, toWorkflowExecutionView } from '../../services/executionService.js';
import { createAuditLog } from '../../services/auditService.js';
import type { ExecutionQueue } from '../../queues/executionQueue.js';
import type { ExecutionCreationOptions } from '../../services/executionService.js';

function getRouteId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new Error('INVALID_WORKFLOW_ID');
  return id;
}

export function createExternalWorkflowRouter(
  queue: ExecutionQueue,
  creationOptions: ExecutionCreationOptions,
) {
  const router = Router();

  router.post(
    '/workflows/:id/trigger',
    createRequireAPIKey(),
    requireAPIKeyPermission('WORKFLOW_EXECUTE'),
    createRateLimitMiddleware(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workflowId = getRouteId(req);
        const parsed = ExternalTriggerSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'Invalid request body' },
          });
        }

        const ctx = getAPIKeyContext(req);
        const workspaceId = ctx.workspaceId;
        const apiKeyId = ctx.apiKeyId;

        const created = await createWorkflowExecution(
          queue,
          workflowId,
          {
            input: parsed.data.input,
            idempotencyKey: parsed.data.idempotencyKey,
          },
          apiKeyId,
          workspaceId,
          creationOptions,
        );

        await createAuditLog({
          action: 'EXTERNAL_WORKFLOW_TRIGGERED',
          userId: apiKeyId,
          workspaceId,
          resource: 'execution',
          resourceId: created.execution._id.toString(),
          metadata: {
            apiKeyId,
            workflowId,
            executionId: created.execution._id.toString(),
            idempotencyKey: parsed.data.idempotencyKey,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        return res.status(202).json({
          ...toWorkflowExecutionView(created.execution),
          replayed: created.replayed,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

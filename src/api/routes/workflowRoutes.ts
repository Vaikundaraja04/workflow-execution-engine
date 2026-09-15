import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { WorkflowDefinition } from '../../types/workflow.js';
import {
  createWorkflow,
  getWorkflow,
  updateDraft,
  validateDraft,
  publishWorkflow,
  getVersions,
} from '../../services/workflowService.js';
import { WorkflowDefinitionSchema } from '../../schemas/workflowSchema.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { resolveWorkspaceId } from '../../services/workspaceService.js';
import { createAuditLog } from '../../services/auditService.js';

const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  definition: WorkflowDefinitionSchema,
  workspaceId: z.string().trim().max(128).optional(),
}).strict();

const updateDraftSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  definition: WorkflowDefinitionSchema.optional(),
}).strict().refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required',
});

function getRouteId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') {
    throw new Error('INVALID_WORKFLOW_ID');
  }
  return id;
}

async function resolveTenantId(req: Request): Promise<string> {
  const requester = getAuthUser(req);
  const body = req.body as { workspaceId?: unknown } | undefined;
  const requested = typeof body?.workspaceId === 'string' ? body.workspaceId : undefined;
  return resolveWorkspaceId(requester.userId, requested);
}
export const workflowRouter = Router();

workflowRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createWorkflowSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const workspaceId = await resolveTenantId(req);
    const wf = await createWorkflow(parsed.data.name, parsed.data.definition, getAuthUser(req).userId, workspaceId);
    await createAuditLog({
      action: 'WORKFLOW_CREATED',
      userId: getAuthUser(req).userId,
      resource: 'workflow',
      resourceId: wf._id.toString(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.status(201).json(wf);
  } catch (err) {
    next(err);
  }
});

workflowRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = await resolveTenantId(req);
    const wf = await getWorkflow(id, getAuthUser(req).userId, workspaceId);
    res.json(wf);
  } catch (err) {
    next(err);
  }
});

workflowRouter.put('/:id/draft', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const updates: { name?: string; definition?: WorkflowDefinition } = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.definition !== undefined) updates.definition = parsed.data.definition;
    const workspaceId = await resolveTenantId(req);
    const wf = await updateDraft(id, updates, getAuthUser(req).userId, workspaceId);
    await createAuditLog({
      action: 'WORKFLOW_UPDATED',
      userId: getAuthUser(req).userId,
      resource: 'workflow',
      resourceId: wf._id.toString(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json(wf);
  } catch (err) {
    next(err);
  }
});

workflowRouter.post('/:id/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = await resolveTenantId(req);
    const result = await validateDraft(id, getAuthUser(req).userId, workspaceId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

workflowRouter.post('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = await resolveTenantId(req);
    const result = await publishWorkflow(id, getAuthUser(req).userId, workspaceId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

workflowRouter.get('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = await resolveTenantId(req);
    const versions = await getVersions(id, getAuthUser(req).userId, workspaceId);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

export default workflowRouter;

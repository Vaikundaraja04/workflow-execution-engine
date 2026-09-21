import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { WorkflowDefinition } from '../../types/workflow.js';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateDraft,
  validateDraft,
  publishWorkflow,
} from '../../services/workflowService.js';
import { WorkflowDefinitionSchema } from '../../schemas/workflowSchema.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { requirePermission, requireMembership, getWorkspaceContext } from '../middleware/requirePermission.js';
import { transferWorkflowOwnership } from '../../services/collaborationService.js';
import {
  compareWorkflowVersions,
  getWorkflowVersion,
  listWorkflowVersions,
  restoreWorkflowVersion,
} from '../../services/versionService.js';
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

const changeSummarySchema = z.object({
  changeSummary: z.string().trim().min(1).max(280).optional(),
}).strict();

const compareSchema = z.object({
  from: z.union([z.string().trim().min(1), z.number().int().positive()]),
  to: z.union([z.string().trim().min(1), z.number().int().positive()]),
}).strict();

const transferSchema = z.object({
  memberId: z.string().trim().min(1).max(64).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
}).strict().refine((data) => data.memberId !== undefined || data.userId !== undefined, {
  message: 'memberId or userId is required',
});

function getRouteId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') {
    throw new Error('INVALID_WORKFLOW_ID');
  }
  return id;
}

const requireWorkflowCreate = requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true });
const requireWorkflowList = requirePermission('WORKFLOW_READ');
const requireWorkflowRead = requirePermission('WORKFLOW_READ', { workflowParam: 'id' });
const requireWorkflowUpdate = requirePermission('WORKFLOW_UPDATE', { workflowParam: 'id' });
const requireWorkflowMembership = requireMembership({ workflowParam: 'id' });

export const workflowRouter = Router();

workflowRouter.post('/', requireWorkflowCreate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createWorkflowSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const wf = await createWorkflow(parsed.data.name, parsed.data.definition, getAuthUser(req).userId, workspaceId);
    await createAuditLog({
      action: 'WORKFLOW_CREATED',
      userId: getAuthUser(req).userId,
      workspaceId,
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

workflowRouter.get('/', requireWorkflowList, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const workflows = await listWorkflows(getAuthUser(req).userId, workspaceId);
    res.json(workflows);
  } catch (err) {
    next(err);
  }
});

workflowRouter.get('/:id', requireWorkflowRead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const wf = await getWorkflow(id, getAuthUser(req).userId, workspaceId);
    res.json(wf);
  } catch (err) {
    next(err);
  }
});

workflowRouter.put('/:id/draft', requireWorkflowUpdate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const updates: { name?: string; definition?: WorkflowDefinition } = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.definition !== undefined) updates.definition = parsed.data.definition;
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const wf = await updateDraft(id, updates, getAuthUser(req).userId, workspaceId);
    await createAuditLog({
      action: 'WORKFLOW_UPDATED',
      userId: getAuthUser(req).userId,
      workspaceId,
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

workflowRouter.post('/:id/validate', requireWorkflowUpdate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const result = await validateDraft(id, getAuthUser(req).userId, workspaceId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

workflowRouter.post('/:id/publish', requireWorkflowUpdate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const parsed = changeSummarySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const result = await publishWorkflow(id, getAuthUser(req).userId, workspaceId, parsed.data.changeSummary);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

workflowRouter.post('/:id/transfer', requireWorkflowMembership, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const reference = parsed.data.memberId ?? parsed.data.userId;
    if (reference === undefined) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const summary = await transferWorkflowOwnership(id, getAuthUser(req).userId, reference, workspaceId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

workflowRouter.get('/:id/versions', requireWorkflowRead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const versions = await listWorkflowVersions(id, getAuthUser(req).userId, workspaceId);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

function getVersionReference(req: Request): string {
  const reference = req.params.versionId;
  if (typeof reference !== 'string' || reference.length === 0) throw new Error('VERSION_NOT_FOUND');
  return reference;
}

workflowRouter.get('/:id/versions/:versionId', requireWorkflowRead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const version = await getWorkflowVersion(id, getVersionReference(req), getAuthUser(req).userId, workspaceId);
    res.json(version);
  } catch (err) {
    next(err);
  }
});

workflowRouter.post('/:id/versions/:versionId/restore', requireWorkflowUpdate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const parsed = changeSummarySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const version = await restoreWorkflowVersion(
      id,
      getVersionReference(req),
      getAuthUser(req).userId,
      workspaceId,
      parsed.data.changeSummary,
    );
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});
workflowRouter.post('/:id/compare', requireWorkflowRead, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const parsed = compareSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const workspaceId = getWorkspaceContext(req).workspaceId;
    const comparison = await compareWorkflowVersions(
      id,
      String(parsed.data.from),
      String(parsed.data.to),
      getAuthUser(req).userId,
      workspaceId,
    );
    res.json(comparison);
  } catch (err) {
    next(err);
  }
});

export default workflowRouter;

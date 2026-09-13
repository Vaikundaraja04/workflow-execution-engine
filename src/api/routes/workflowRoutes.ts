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

const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  definition: WorkflowDefinitionSchema,
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

export const workflowRouter = Router();

workflowRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createWorkflowSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
    }
    const wf = await createWorkflow(parsed.data.name, parsed.data.definition);
    res.status(201).json(wf);
  } catch (err) {
    next(err);
  }
});

workflowRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const wf = await getWorkflow(id);
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
    const wf = await updateDraft(id, updates);
    res.json(wf);
  } catch (err) {
    next(err);
  }
});

workflowRouter.post('/:id/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const result = await validateDraft(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

workflowRouter.post('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const result = await publishWorkflow(id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

workflowRouter.get('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getRouteId(req);
    const versions = await getVersions(id);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

export default workflowRouter;

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { TemplateService } from '../../services/templateService.js';
import { WorkflowDefinitionSchema } from '../../schemas/workflowSchema.js';
import { TEMPLATE_CATEGORIES, TEMPLATE_VISIBILITY } from '../../models/WorkflowTemplateModel.js';
import { roleHasTemplatePermission } from '../../auth/permissions.js';

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  category: z.string().refine((cat) => (TEMPLATE_CATEGORIES as readonly string[]).includes(cat), {
    message: `Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
  }),
  visibility: z.enum(TEMPLATE_VISIBILITY).default('PRIVATE'),
  tags: z.array(z.string().trim().max(30)).max(20).optional().default([]),
  metadata: z.object({
    icon: z.string().max(200).optional(),
    documentation: z.string().max(10000).optional(),
    requirements: z.array(z.string().max(100)).max(50).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  workflowDefinition: WorkflowDefinitionSchema.optional(),
  workflow: WorkflowDefinitionSchema.optional(),
  workspaceId: z.string().trim().optional(),
}).strict().refine((data) => data.workflowDefinition !== undefined || data.workflow !== undefined, {
  message: 'workflowDefinition or workflow is required',
});

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  category: z.string().refine((cat) => (TEMPLATE_CATEGORIES as readonly string[]).includes(cat), {
    message: `Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
  }).optional(),
  visibility: z.enum(TEMPLATE_VISIBILITY).optional(),
  tags: z.array(z.string().trim().max(30)).max(20).optional(),
  metadata: z.object({
    icon: z.string().max(200).optional(),
    documentation: z.string().max(10000).optional(),
    requirements: z.array(z.string().max(100)).max(50).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  workflowDefinition: WorkflowDefinitionSchema.optional(),
  workflow: WorkflowDefinitionSchema.optional(),
  changeSummary: z.string().trim().max(500).optional(),
}).strict();

const rateTemplateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().trim().max(500).optional(),
}).strict();

const installTemplateSchema = z.object({
  workspaceId: z.string().trim().optional(),
  workflowName: z.string().trim().min(1).max(120).optional(),
}).strict();

function resolveWorkspaceId(req: Request): string | undefined {
  const headerWs = req.headers['x-workspace-id'];
  if (typeof headerWs === 'string' && Types.ObjectId.isValid(headerWs)) {
    return headerWs;
  }
  const bodyWs = req.body?.workspaceId;
  if (typeof bodyWs === 'string' && Types.ObjectId.isValid(bodyWs)) {
    return bodyWs;
  }
  const queryWs = req.query.workspaceId;
  if (typeof queryWs === 'string' && Types.ObjectId.isValid(queryWs)) {
    return queryWs;
  }
  return undefined;
}

function getRouteId(req: Request, param = 'id'): string {
  const id = req.params[param];
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_TEMPLATE_ID');
  }
  return id;
}

export function createTemplateRouter(): Router {
  const router = Router();

  // GET /api/v1/templates - Search and list templates
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = getAuthUser(req);
      const query = (req.query.q as string) || (req.query.search as string) || '';
      const category = req.query.category as string | undefined;
      const visibility = req.query.visibility as any;
      const status = req.query.status as any;
      const marketplaceStatus = req.query.marketplaceStatus as any;
      const tags = req.query.tags as string | string[] | undefined;
      const createdBy = req.query.createdBy as string | undefined;
      const workspaceId = resolveWorkspaceId(req);

      const sortBy = req.query.sortBy as any;
      const sortOrder = req.query.sortOrder as any;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await TemplateService.searchTemplates(
        query,
        {
          category,
          visibility,
          status,
          marketplaceStatus,
          tags,
          createdBy,
          workspaceId,
        },
        {
          sortBy,
          sortOrder,
          page,
          limit,
        },
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/templates/:id - Get template by ID
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const workspaceId = resolveWorkspaceId(req);

      const template = await TemplateService.getTemplateById(id, userId, workspaceId);
      res.json(template);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates - Create template
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = getAuthUser(req);
      const parsed = createTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request body',
          },
        });
      }

      const workspaceId = parsed.data.workspaceId || resolveWorkspaceId(req);

      // Verify workspace permission if workspaceId is supplied
      if (workspaceId) {
        const role = await TemplateService.getUserWorkspaceRole(workspaceId, userId);
        if (!role || !roleHasTemplatePermission(role, 'TEMPLATE_CREATE')) {
          return res.status(403).json({
            error: { code: 'FORBIDDEN', message: 'Insufficient permission to create templates in workspace' },
          });
        }
      }

      const definition = (parsed.data.workflowDefinition || parsed.data.workflow)!;

      const template = await TemplateService.createTemplate(userId, workspaceId, {
        name: parsed.data.name,
        description: parsed.data.description,
        category: parsed.data.category,
        visibility: parsed.data.visibility,
        tags: parsed.data.tags,
        metadata: parsed.data.metadata,
        workflowDefinition: definition,
      });

      res.status(201).json(template);
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/v1/templates/:id - Update template
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const parsed = updateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request body',
          },
        });
      }

      const definition = parsed.data.workflowDefinition || parsed.data.workflow;
      const workspaceId = resolveWorkspaceId(req);

      const template = await TemplateService.updateTemplate(
        id,
        userId,
        {
          name: parsed.data.name,
          description: parsed.data.description,
          category: parsed.data.category,
          visibility: parsed.data.visibility,
          tags: parsed.data.tags,
          metadata: parsed.data.metadata,
          workflowDefinition: definition,
          changeSummary: parsed.data.changeSummary,
        },
        workspaceId,
      );

      res.json(template);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/:id/publish - Publish template
  router.post('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const isMarketplaceApproval = req.body?.approve === true;
      const workspaceId = resolveWorkspaceId(req);

      const template = await TemplateService.publishTemplate(id, userId, {
        isMarketplaceApproval,
        workspaceId,
      });

      res.json(template);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/:id/archive - Archive template
  router.post('/:id/archive', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);

      const template = await TemplateService.archiveTemplate(id, userId);
      res.json(template);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/:id/install - Install template into workspace
  router.post('/:id/install', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const parsed = installTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
      }

      const targetWorkspaceId = parsed.data.workspaceId || resolveWorkspaceId(req);
      if (!targetWorkspaceId) {
        return res.status(400).json({
          error: { code: 'INVALID_WORKSPACE_ID', message: 'Target workspaceId is required' },
        });
      }

      const result = await TemplateService.installTemplate(
        id,
        userId,
        targetWorkspaceId,
        parsed.data.workflowName,
      );

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/:id/clone - Clone template
  router.post('/:id/clone', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const workspaceId = resolveWorkspaceId(req);
      const newName = req.body?.name;

      const cloned = await TemplateService.cloneTemplate(id, userId, workspaceId, newName);
      res.status(201).json(cloned);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/:id/export - Export template as package
  router.post('/:id/export', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);

      const packageData = await TemplateService.exportTemplate(id, userId);
      res.json(packageData);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/import - Import template package
  router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = getAuthUser(req);
      const workspaceId = resolveWorkspaceId(req);
      const packagePayload = req.body.packageData || req.body.package || req.body;
      const visibility = req.body.visibility;

      if (workspaceId) {
        const role = await TemplateService.getUserWorkspaceRole(workspaceId, userId);
        if (!role || !roleHasTemplatePermission(role, 'TEMPLATE_CREATE')) {
          return res.status(403).json({
            error: { code: 'FORBIDDEN', message: 'Insufficient permission to import templates into workspace' },
          });
        }
      }

      const template = await TemplateService.importTemplate(userId, workspaceId, packagePayload, visibility);
      res.status(201).json(template);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/:id/rate - Rate template
  router.post('/:id/rate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const parsed = rateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Rating must be an integer from 1 to 5' } });
      }

      const template = await TemplateService.rateTemplate(id, userId, parsed.data.rating, parsed.data.review);
      res.json(template);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/templates/:id/versions - List template versions
  router.get('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const workspaceId = resolveWorkspaceId(req);

      const versions = await TemplateService.getTemplateVersions(id, userId, workspaceId);
      res.json({ versions });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/templates/:id/rollback - Rollback template version
  router.post('/:id/rollback', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const { userId } = getAuthUser(req);
      const versionNumber = Number(req.body.versionNumber);
      if (!versionNumber || versionNumber < 1) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Valid versionNumber is required' } });
      }

      const template = await TemplateService.rollbackVersion(id, versionNumber, userId);
      res.json(template);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/templates/:id/compare - Compare two versions
  router.get('/:id/compare', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const v1 = Number(req.query.v1);
      const v2 = Number(req.query.v2);

      if (!v1 || !v2 || v1 < 1 || v2 < 1) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'v1 and v2 version numbers are required' } });
      }

      const diff = await TemplateService.compareVersions(id, v1, v2);
      res.json(diff);
    } catch (error) {
      next(error);
    }
  });

  // Publisher Profile endpoints
  router.get('/publisher/profile', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = getAuthUser(req);
      const profile = await TemplateService.getPublisherProfile(userId);
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  });

  router.put('/publisher/profile', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = getAuthUser(req);
      const displayName = req.body?.displayName;
      if (!displayName || typeof displayName !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'displayName is required' } });
      }
      const description = req.body?.description;
      const profile = await TemplateService.createOrUpdatePublisherProfile(userId, {
        displayName,
        description,
      });
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createTemplateRouter;

import crypto from 'crypto';
import { Types } from 'mongoose';
import { WorkflowTemplateModel, type IWorkflowTemplate, type TemplateVisibility, type TemplateStatus, type MarketplaceStatus, TEMPLATE_CATEGORIES } from '../models/WorkflowTemplateModel.js';
import { TemplateVersionModel, type ITemplateVersion } from '../models/TemplateVersionModel.js';
import { PublisherProfileModel, type IPublisherProfile } from '../models/PublisherProfileModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import type { WorkflowDefinition } from '../types/workflow.js';
import { WorkflowDefinitionSchema } from '../schemas/workflowSchema.js';
import { validateGraph } from '../engine/validateGraph.js';
import { createAuditLog } from './auditService.js';
import { recordWorkflowCreated } from './analyticsService.js';
import { validateWorkspaceQuota } from './planService.js';
import { WorkflowPackageService, type WorkflowPackageData } from './workflowPackageService.js';
import {
  TemplateNotFoundError,
  TemplateAccessDeniedError,
  TemplatePublishError,
  TemplateValidationError,
} from '../errors/templateErrors.js';
import { roleHasTemplatePermission } from '../auth/permissions.js';

export interface CreateTemplateInput {
  name: string;
  description?: string | undefined;
  category: string;
  visibility: TemplateVisibility;
  tags?: string[] | undefined;
  metadata?: {
    icon?: string | undefined;
    documentation?: string | undefined;
    requirements?: string[] | undefined;
    variables?: Record<string, unknown> | undefined;
  } | undefined;
  workflowDefinition: WorkflowDefinition;
}

export interface UpdateTemplateInput {
  name?: string | undefined;
  description?: string | undefined;
  category?: string | undefined;
  visibility?: TemplateVisibility | undefined;
  tags?: string[] | undefined;
  metadata?: {
    icon?: string | undefined;
    documentation?: string | undefined;
    requirements?: string[] | undefined;
    variables?: Record<string, unknown> | undefined;
  } | undefined;
  workflowDefinition?: WorkflowDefinition | undefined;
  changeSummary?: string | undefined;
}

export interface SearchTemplateFilters {
  category?: string | string[] | undefined;
  visibility?: TemplateVisibility | TemplateVisibility[] | undefined;
  status?: TemplateStatus | TemplateStatus[] | undefined;
  marketplaceStatus?: MarketplaceStatus | MarketplaceStatus[] | undefined;
  tags?: string | string[] | undefined;
  createdBy?: string | Types.ObjectId | undefined;
  workspaceId?: string | Types.ObjectId | undefined;
}

export interface SearchTemplateOptions {
  page?: number | undefined;
  limit?: number | undefined;
  sortBy?: ('createdAt' | 'name' | 'downloads' | 'rating' | 'executions' | 'installs') | undefined;
  sortOrder?: ('asc' | 'desc') | undefined;
}

function calculateDefinitionHash(definition: WorkflowDefinition): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(definition))
    .digest('hex');
}

function validateWorkflowDefinition(definition: unknown): WorkflowDefinition {
  const schemaResult = WorkflowDefinitionSchema.safeParse(definition);
  if (!schemaResult.success) {
    const issue = schemaResult.error.issues[0];
    throw new TemplateValidationError(`Invalid workflow definition: ${issue?.message || 'schema mismatch'}`);
  }
  const graphErrors = validateGraph(schemaResult.data);
  if (graphErrors.length > 0) {
    throw new TemplateValidationError(`Invalid workflow graph: ${graphErrors[0]?.message}`);
  }
  return schemaResult.data;
}

export class TemplateService {
  /**
   * Helper to verify user permissions in a workspace
   */
  static async getUserWorkspaceRole(
    workspaceId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
  ): Promise<'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | null> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const workspace = await WorkspaceModel.findById(wsId);
    if (!workspace) return null;
    if (workspace.ownerId.equals(uId)) return 'OWNER';

    const member = await WorkspaceMemberModel.findOne({
      workspaceId: wsId,
      userId: uId,
      status: 'ACTIVE',
    });

    return member ? member.role : null;
  }

  /**
   * Create a new workflow template
   */
  static async createTemplate(
    userId: Types.ObjectId | string,
    workspaceId: Types.ObjectId | string | null | undefined,
    input: CreateTemplateInput,
  ): Promise<IWorkflowTemplate> {
    const userObjId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const wsObjId = workspaceId ? (typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId) : undefined;

    // Validate category
    if (!TEMPLATE_CATEGORIES.includes(input.category as any)) {
      throw new TemplateValidationError(`Invalid category. Must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`);
    }

    // Validate workflow definition & graph
    const validDefinition = validateWorkflowDefinition(input.workflowDefinition);

    // If workspace-scoped, check workspace permissions (must have TEMPLATE_CREATE / EDITOR+)
    if (wsObjId) {
      const role = await this.getUserWorkspaceRole(wsObjId, userObjId);
      if (!role || !roleHasTemplatePermission(role, 'TEMPLATE_CREATE')) {
        throw new TemplateAccessDeniedError('User lacks permission to create templates in this workspace');
      }
    }

    const templateId = new Types.ObjectId();
    const hash = calculateDefinitionHash(validDefinition);

    // Create initial version (Version 1)
    const initialVersion = await TemplateVersionModel.create({
      templateId,
      versionNumber: 1,
      workflowDefinition: validDefinition,
      definitionHash: hash,
      changeSummary: 'Initial version',
      createdBy: userObjId,
    });

    const isMarketplace = input.visibility === 'MARKETPLACE';

    const template = await WorkflowTemplateModel.create({
      _id: templateId,
      name: input.name.trim(),
      description: input.description?.trim() || '',
      category: input.category,
      visibility: input.visibility,
      status: 'DRAFT',
      marketplaceStatus: isMarketplace ? 'DRAFT' : undefined,
      workspaceId: wsObjId,
      createdBy: userObjId,
      publisherId: userObjId,
      workflowDefinition: validDefinition,
      latestVersion: initialVersion._id,
      versionCount: 1,
      tags: input.tags || [],
      metadata: input.metadata || {
        icon: undefined,
        documentation: undefined,
        requirements: [],
        variables: {},
      },
      statistics: {
        downloads: 0,
        installs: 0,
        executions: 0,
      },
      rating: {
        average: 0,
        count: 0,
      },
    });

    await createAuditLog({
      action: 'TEMPLATE_CREATED',
      userId: userObjId,
      workspaceId: wsObjId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: {
        name: template.name,
        category: template.category,
        visibility: template.visibility,
      },
    });

    return template;
  }

  /**
   * Get template by ID with visibility checks
   */
  static async getTemplateById(
    templateId: Types.ObjectId | string,
    userId?: Types.ObjectId | string,
    workspaceId?: Types.ObjectId | string,
  ): Promise<IWorkflowTemplate> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const template = await WorkflowTemplateModel.findById(tId);
    if (!template) {
      throw new TemplateNotFoundError('Template not found');
    }

    // Check visibility
    if (template.visibility === 'PUBLIC' || (template.visibility === 'MARKETPLACE' && template.status === 'PUBLISHED')) {
      return template;
    }

    // If private or workspace scoped, check user or workspace access
    if (userId) {
      const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      if (template.createdBy.equals(uId) || template.publisherId?.equals(uId)) {
        return template;
      }
    }

    if (template.workspaceId && (workspaceId || userId)) {
      const wsId = workspaceId
        ? (typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId)
        : template.workspaceId;

      if (template.workspaceId.equals(wsId)) {
        if (userId) {
          const role = await this.getUserWorkspaceRole(wsId, userId);
          if (role) return template;
        } else {
          return template;
        }
      }
    }

    throw new TemplateAccessDeniedError('You do not have access to this template');
  }

  /**
   * Update template details and optionally workflow definition
   */
  static async updateTemplate(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    updates: UpdateTemplateInput,
    workspaceId?: Types.ObjectId | string,
  ): Promise<IWorkflowTemplate> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const template = await WorkflowTemplateModel.findById(tId);
    if (!template) throw new TemplateNotFoundError('Template not found');

    // Verify update permissions
    const isCreatorOrPublisher = template.createdBy.equals(uId) || template.publisherId?.equals(uId);
    if (!isCreatorOrPublisher && template.workspaceId) {
      const role = await this.getUserWorkspaceRole(template.workspaceId, uId);
      if (!role || !roleHasTemplatePermission(role, 'TEMPLATE_MANAGE')) {
        throw new TemplateAccessDeniedError('Insufficient permissions to update template');
      }
    } else if (!isCreatorOrPublisher) {
      throw new TemplateAccessDeniedError('Insufficient permissions to update template');
    }

    if (updates.name !== undefined) template.name = updates.name.trim();
    if (updates.description !== undefined) template.description = updates.description.trim();
    if (updates.category !== undefined) {
      if (!TEMPLATE_CATEGORIES.includes(updates.category as any)) {
        throw new TemplateValidationError(`Invalid category. Must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`);
      }
      template.category = updates.category;
    }
    if (updates.visibility !== undefined) template.visibility = updates.visibility;
    if (updates.tags !== undefined) template.tags = updates.tags;
    if (updates.metadata !== undefined) template.metadata = { ...template.metadata, ...updates.metadata };

    // If workflow definition changed, create a new version
    if (updates.workflowDefinition !== undefined) {
      const validDefinition = validateWorkflowDefinition(updates.workflowDefinition);
      const newHash = calculateDefinitionHash(validDefinition);

      // Check against current definition hash
      const currentVersion = await TemplateVersionModel.findById(template.latestVersion);
      if (!currentVersion || currentVersion.definitionHash !== newHash) {
        const nextVersionNum = template.versionCount + 1;
        const newVersion = await TemplateVersionModel.create({
          templateId: template._id,
          versionNumber: nextVersionNum,
          workflowDefinition: validDefinition,
          definitionHash: newHash,
          changeSummary: updates.changeSummary || `Version ${nextVersionNum} update`,
          createdBy: uId,
        });

        template.workflowDefinition = validDefinition;
        template.latestVersion = newVersion._id;
        template.versionCount = nextVersionNum;
      }
    }

    await template.save();

    await createAuditLog({
      action: 'TEMPLATE_UPDATED',
      userId: uId,
      workspaceId: template.workspaceId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: {
        name: template.name,
        versionCount: template.versionCount,
        changeSummary: updates.changeSummary,
      },
    });

    return template;
  }

  /**
   * Publish a template
   */
  static async publishTemplate(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    options?: { isMarketplaceApproval?: boolean | undefined; workspaceId?: Types.ObjectId | string | undefined } | undefined,
  ): Promise<IWorkflowTemplate> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const template = await WorkflowTemplateModel.findById(tId);
    if (!template) throw new TemplateNotFoundError('Template not found');

    if (template.status === 'ARCHIVED') {
      throw new TemplatePublishError('Cannot publish an archived template');
    }

    // Check permissions
    const isCreatorOrPublisher = template.createdBy.equals(uId) || template.publisherId?.equals(uId);
    let role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | null = null;
    if (template.workspaceId) {
      role = await this.getUserWorkspaceRole(template.workspaceId, uId);
    }

    if (template.visibility === 'MARKETPLACE') {
      // Marketplace publishing requires approval
      if (options?.isMarketplaceApproval) {
        if (template.workspaceId) {
          if (role !== 'OWNER') {
            throw new TemplateAccessDeniedError('Marketplace publishing requires workspace OWNER approval');
          }
        }
        template.marketplaceStatus = 'APPROVED';
        template.status = 'PUBLISHED';
      } else {
        // Regular publish request for marketplace submits for approval
        template.marketplaceStatus = 'SUBMITTED';
        template.status = 'DRAFT'; // remains draft until approved
      }
    } else {
      if (!isCreatorOrPublisher && (!role || !roleHasTemplatePermission(role, 'TEMPLATE_PUBLISH'))) {
        throw new TemplateAccessDeniedError('User lacks permission to publish this template');
      }
      template.status = 'PUBLISHED';
    }

    await template.save();

    await createAuditLog({
      action: 'TEMPLATE_PUBLISHED',
      userId: uId,
      workspaceId: template.workspaceId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: {
        visibility: template.visibility,
        status: template.status,
        marketplaceStatus: template.marketplaceStatus,
      },
    });

    return template;
  }

  /**
   * Archive a template
   */
  static async archiveTemplate(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
  ): Promise<IWorkflowTemplate> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const template = await WorkflowTemplateModel.findById(tId);
    if (!template) throw new TemplateNotFoundError('Template not found');

    const isCreatorOrPublisher = template.createdBy.equals(uId) || template.publisherId?.equals(uId);
    if (!isCreatorOrPublisher && template.workspaceId) {
      const role = await this.getUserWorkspaceRole(template.workspaceId, uId);
      if (!role || !roleHasTemplatePermission(role, 'TEMPLATE_MANAGE')) {
        throw new TemplateAccessDeniedError('Insufficient permissions to archive template');
      }
    } else if (!isCreatorOrPublisher) {
      throw new TemplateAccessDeniedError('Insufficient permissions to archive template');
    }

    template.status = 'ARCHIVED';
    await template.save();

    await createAuditLog({
      action: 'TEMPLATE_ARCHIVED',
      userId: uId,
      workspaceId: template.workspaceId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: { name: template.name },
    });

    return template;
  }

  /**
   * Install a template into a target workspace as a new runnable workflow
   */
  static async installTemplate(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    targetWorkspaceId: Types.ObjectId | string,
    workflowName?: string,
  ): Promise<{ workflow: any; version: any }> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const targetWsId = typeof targetWorkspaceId === 'string' ? new Types.ObjectId(targetWorkspaceId) : targetWorkspaceId;

    // Verify workspace membership & install permission (VIEWER+ can install)
    const role = await this.getUserWorkspaceRole(targetWsId, uId);
    if (!role || !roleHasTemplatePermission(role, 'TEMPLATE_INSTALL')) {
      throw new TemplateAccessDeniedError('User lacks permission to install templates into this workspace');
    }

    const template = await this.getTemplateById(tId, uId, targetWsId);

    // Validate quota before installing
    await validateWorkspaceQuota(targetWsId.toString(), 'workflows');

    // Create new workflow in workspace
    const newWorkflowName = (workflowName || template.name).trim();
    const definition = template.workflowDefinition;
    const defHash = calculateDefinitionHash(definition);

    const workflow = await WorkflowModel.create({
      name: newWorkflowName,
      ownerId: uId,
      workspaceId: targetWsId,
      createdBy: uId,
      draftDefinition: definition,
      status: 'PUBLISHED',
      latestVersionNumber: 1,
    });

    const version = await WorkflowVersionModel.create({
      workflowId: workflow._id,
      workspaceId: targetWsId,
      versionNumber: 1,
      definition,
      definitionHash: defHash,
      createdBy: uId,
      status: 'PUBLISHED',
      changeSummary: `Installed from template: ${template.name}`,
    });

    workflow.publishedVersionId = version._id;
    await workflow.save();

    // Increment template installs & executions
    await WorkflowTemplateModel.findByIdAndUpdate(tId, {
      $inc: { 'statistics.installs': 1, 'statistics.downloads': 1 },
    });

    await recordWorkflowCreated(targetWsId.toString());

    await createAuditLog({
      action: 'TEMPLATE_INSTALLED',
      userId: uId,
      workspaceId: targetWsId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: {
        templateName: template.name,
        installedWorkflowId: workflow._id.toString(),
        workflowName: workflow.name,
      },
    });

    return {
      workflow: workflow.toObject(),
      version: version.toObject(),
    };
  }

  /**
   * Clone an existing template into a new template (e.g. for customization)
   */
  static async cloneTemplate(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    workspaceId: Types.ObjectId | string | null | undefined,
    newName?: string,
  ): Promise<IWorkflowTemplate> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const targetWsId = workspaceId ? (typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId) : undefined;

    const source = await this.getTemplateById(tId, uId, targetWsId);

    const cloned = await this.createTemplate(uId, targetWsId, {
      name: newName || `${source.name} (Copy)`,
      description: source.description,
      category: source.category,
      visibility: 'PRIVATE',
      tags: [...source.tags],
      metadata: { ...source.metadata },
      workflowDefinition: source.workflowDefinition,
    });

    return cloned;
  }

  /**
   * Export template as a portable workflow package
   */
  static async exportTemplate(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
  ): Promise<WorkflowPackageData> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const template = await this.getTemplateById(tId, uId);

    // Get all versions
    const versions = await TemplateVersionModel.find({ templateId: tId })
      .sort({ versionNumber: 1 })
      .lean();

    const packageData = WorkflowPackageService.createPackage({
      template: {
        name: template.name,
        description: template.description,
        category: template.category,
        tags: template.tags,
        visibility: template.visibility,
      },
      workflow: template.workflowDefinition,
      versions: versions.map((v) => ({
        versionNumber: v.versionNumber,
        workflowDefinition: v.workflowDefinition,
        definitionHash: v.definitionHash,
        changeSummary: v.changeSummary,
        createdAt: v.createdAt,
      })),
      variables: (template.metadata?.variables as Record<string, unknown>) || {},
      metadata: {
        icon: template.metadata?.icon,
        documentation: template.metadata?.documentation,
        requirements: template.metadata?.requirements,
      },
    });

    // Increment download statistics
    await WorkflowTemplateModel.findByIdAndUpdate(tId, {
      $inc: { 'statistics.downloads': 1 },
    });

    await createAuditLog({
      action: 'TEMPLATE_EXPORTED',
      userId: uId,
      workspaceId: template.workspaceId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: { templateName: template.name },
    });

    return packageData;
  }

  /**
   * Import workflow package as a new template
   */
  static async importTemplate(
    userId: Types.ObjectId | string,
    workspaceId: Types.ObjectId | string | null | undefined,
    packagePayload: unknown,
    visibilityOverride?: TemplateVisibility,
  ): Promise<IWorkflowTemplate> {
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const wsId = workspaceId ? (typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId) : undefined;

    // Validate package schema, security, nodes, graph
    const validatedPkg = WorkflowPackageService.validatePackage(packagePayload);

    const visibility = visibilityOverride || (validatedPkg.template.visibility as TemplateVisibility) || 'PRIVATE';

    // Create the template
    const template = await this.createTemplate(uId, wsId, {
      name: validatedPkg.template.name,
      description: validatedPkg.template.description,
      category: validatedPkg.template.category,
      visibility,
      tags: validatedPkg.template.tags,
      metadata: {
        icon: validatedPkg.metadata?.icon,
        documentation: validatedPkg.metadata?.documentation,
        requirements: validatedPkg.metadata?.requirements,
        variables: validatedPkg.variables,
      },
      workflowDefinition: validatedPkg.workflow,
    });

    // If package includes additional versions (> 1), import them
    if (validatedPkg.versions && validatedPkg.versions.length > 1) {
      for (const ver of validatedPkg.versions) {
        if (ver.versionNumber === 1) continue; // version 1 is created with the template
        await TemplateVersionModel.create({
          templateId: template._id,
          versionNumber: ver.versionNumber,
          workflowDefinition: ver.workflowDefinition,
          definitionHash: ver.definitionHash || calculateDefinitionHash(ver.workflowDefinition),
          changeSummary: ver.changeSummary || `Imported version ${ver.versionNumber}`,
          createdBy: uId,
        });
      }
      const maxVer = Math.max(...validatedPkg.versions.map((v) => v.versionNumber));
      const latestVerDoc = await TemplateVersionModel.findOne({ templateId: template._id, versionNumber: maxVer });
      if (latestVerDoc) {
        template.latestVersion = latestVerDoc._id;
        template.versionCount = maxVer;
        template.workflowDefinition = latestVerDoc.workflowDefinition;
        await template.save();
      }
    }

    await createAuditLog({
      action: 'TEMPLATE_IMPORTED',
      userId: uId,
      workspaceId: wsId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: {
        templateName: template.name,
        category: template.category,
      },
    });

    return template;
  }

  /**
   * Search templates with MongoDB indexes, filters, pagination, and sorting
   */
  static async searchTemplates(
    query = '',
    filters: SearchTemplateFilters = {},
    options: SearchTemplateOptions = {},
  ): Promise<{ templates: IWorkflowTemplate[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const mongoQuery: Record<string, unknown> = {};

    // Search query: text search or regex matching
    if (query.trim()) {
      const q = query.trim();
      mongoQuery.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } },
        { category: { $regex: q, $options: 'i' } },
      ];
    }

    // Category filter
    if (filters.category) {
      if (Array.isArray(filters.category)) {
        mongoQuery.category = { $in: filters.category };
      } else {
        mongoQuery.category = filters.category;
      }
    }

    // Visibility filter
    if (filters.visibility) {
      if (Array.isArray(filters.visibility)) {
        mongoQuery.visibility = { $in: filters.visibility };
      } else {
        mongoQuery.visibility = filters.visibility;
      }
    }

    // Status filter
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        mongoQuery.status = { $in: filters.status };
      } else {
        mongoQuery.status = filters.status;
      }
    }

    // Marketplace status filter
    if (filters.marketplaceStatus) {
      if (Array.isArray(filters.marketplaceStatus)) {
        mongoQuery.marketplaceStatus = { $in: filters.marketplaceStatus };
      } else {
        mongoQuery.marketplaceStatus = filters.marketplaceStatus;
      }
    }

    // Tags filter
    if (filters.tags) {
      const tagList = Array.isArray(filters.tags) ? filters.tags : [filters.tags];
      mongoQuery.tags = { $in: tagList };
    }

    // Workspace filter
    if (filters.workspaceId) {
      const wsId = typeof filters.workspaceId === 'string' ? new Types.ObjectId(filters.workspaceId) : filters.workspaceId;
      mongoQuery.workspaceId = wsId;
    }

    // Creator filter
    if (filters.createdBy) {
      const uId = typeof filters.createdBy === 'string' ? new Types.ObjectId(filters.createdBy) : filters.createdBy;
      mongoQuery.createdBy = uId;
    }

    // Sort setup
    const sort: Record<string, 1 | -1> = {};
    const sortOrder: 1 | -1 = options.sortOrder === 'asc' ? 1 : -1;

    switch (options.sortBy) {
      case 'downloads':
        sort['statistics.downloads'] = sortOrder;
        break;
      case 'rating':
        sort['rating.average'] = sortOrder;
        break;
      case 'executions':
        sort['statistics.executions'] = sortOrder;
        break;
      case 'installs':
        sort['statistics.installs'] = sortOrder;
        break;
      case 'name':
        sort.name = sortOrder;
        break;
      case 'createdAt':
      default:
        sort.createdAt = sortOrder;
        break;
    }

    const [templates, total] = await Promise.all([
      WorkflowTemplateModel.find(mongoQuery)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('publisherId', 'displayName verified email')
        .exec(),
      WorkflowTemplateModel.countDocuments(mongoQuery),
    ]);

    return {
      templates,
      total,
      page,
      limit,
    };
  }

  /**
   * Rate a template (1-5 stars with optional review)
   */
  static async rateTemplate(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    rating: number,
    review?: string,
  ): Promise<IWorkflowTemplate> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      throw new TemplateValidationError('Rating must be a number between 1 and 5');
    }

    const template = await WorkflowTemplateModel.findById(tId);
    if (!template) throw new TemplateNotFoundError('Template not found');

    if (!template.ratingsList) template.ratingsList = [];

    const existingIdx = template.ratingsList.findIndex((r) => r.userId.equals(uId));
    if (existingIdx >= 0) {
      template.ratingsList[existingIdx] = {
        userId: uId,
        rating,
        review: review?.trim() || '',
        createdAt: new Date(),
      };
    } else {
      template.ratingsList.push({
        userId: uId,
        rating,
        review: review?.trim() || '',
        createdAt: new Date(),
      });
    }

    const totalRatings = template.ratingsList.reduce((sum, r) => sum + r.rating, 0);
    template.rating = {
      average: Number((totalRatings / template.ratingsList.length).toFixed(2)),
      count: template.ratingsList.length,
    };

    await template.save();

    await createAuditLog({
      action: 'TEMPLATE_RATED',
      userId: uId,
      workspaceId: template.workspaceId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: {
        rating,
        average: template.rating.average,
        count: template.rating.count,
      },
    });

    return template;
  }

  /**
   * Create a new version for a template
   */
  static async createVersion(
    templateId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    workflowDefinition: WorkflowDefinition,
    changeSummary?: string,
  ): Promise<ITemplateVersion> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const template = await WorkflowTemplateModel.findById(tId);
    if (!template) throw new TemplateNotFoundError('Template not found');

    const validDefinition = validateWorkflowDefinition(workflowDefinition);
    const hash = calculateDefinitionHash(validDefinition);

    const versionNumber = template.versionCount + 1;
    const version = await TemplateVersionModel.create({
      templateId: template._id,
      versionNumber,
      workflowDefinition: validDefinition,
      definitionHash: hash,
      changeSummary: changeSummary || `Version ${versionNumber}`,
      createdBy: uId,
    });

    template.workflowDefinition = validDefinition;
    template.latestVersion = version._id;
    template.versionCount = versionNumber;
    await template.save();

    return version;
  }

  /**
   * Rollback template to a specific version number
   */
  static async rollbackVersion(
    templateId: Types.ObjectId | string,
    versionNumber: number,
    userId: Types.ObjectId | string,
  ): Promise<IWorkflowTemplate> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const template = await WorkflowTemplateModel.findById(tId);
    if (!template) throw new TemplateNotFoundError('Template not found');

    const targetVersion = await TemplateVersionModel.findOne({ templateId: tId, versionNumber });
    if (!targetVersion) {
      throw new TemplateValidationError(`Version ${versionNumber} does not exist`);
    }

    // Creating a new version from rollback
    const nextVerNum = template.versionCount + 1;
    const rolledBackVersion = await TemplateVersionModel.create({
      templateId: template._id,
      versionNumber: nextVerNum,
      workflowDefinition: targetVersion.workflowDefinition,
      definitionHash: targetVersion.definitionHash,
      changeSummary: `Rollback to version ${versionNumber}`,
      createdBy: uId,
    });

    template.workflowDefinition = targetVersion.workflowDefinition;
    template.latestVersion = rolledBackVersion._id;
    template.versionCount = nextVerNum;
    await template.save();

    await createAuditLog({
      action: 'TEMPLATE_UPDATED',
      userId: uId,
      workspaceId: template.workspaceId,
      resource: 'WorkflowTemplate',
      resourceId: template._id.toString(),
      metadata: {
        action: 'rollback',
        targetVersionNumber: versionNumber,
        newVersionNumber: nextVerNum,
      },
    });

    return template;
  }

  /**
   * Compare two versions of a template
   */
  static async compareVersions(
    templateId: Types.ObjectId | string,
    v1: number,
    v2: number,
  ): Promise<{
    v1: ITemplateVersion;
    v2: ITemplateVersion;
    nodeChanges: { added: string[]; removed: string[]; modified: string[] };
  }> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;

    const [ver1, ver2] = await Promise.all([
      TemplateVersionModel.findOne({ templateId: tId, versionNumber: v1 }),
      TemplateVersionModel.findOne({ templateId: tId, versionNumber: v2 }),
    ]);

    if (!ver1 || !ver2) {
      throw new TemplateValidationError('One or both specified versions do not exist');
    }

    const v1Nodes = new Map(ver1.workflowDefinition.nodes.map((n) => [n.id, n]));
    const v2Nodes = new Map(ver2.workflowDefinition.nodes.map((n) => [n.id, n]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    for (const [id, node] of v2Nodes) {
      if (!v1Nodes.has(id)) {
        added.push(id);
      } else {
        const oldNode = v1Nodes.get(id);
        if (JSON.stringify(oldNode) !== JSON.stringify(node)) {
          modified.push(id);
        }
      }
    }

    for (const id of v1Nodes.keys()) {
      if (!v2Nodes.has(id)) {
        removed.push(id);
      }
    }

    return {
      v1: ver1,
      v2: ver2,
      nodeChanges: { added, removed, modified },
    };
  }

  /**
   * Get all versions for a template
   */
  static async getTemplateVersions(
    templateId: Types.ObjectId | string,
    userId?: Types.ObjectId | string,
    workspaceId?: Types.ObjectId | string,
  ): Promise<ITemplateVersion[]> {
    const tId = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    // Check template access
    await this.getTemplateById(tId, userId, workspaceId);

    return TemplateVersionModel.find({ templateId: tId }).sort({ versionNumber: 1 }).exec();
  }

  /**
   * Publisher Profile management
   */
  static async getPublisherProfile(userId: Types.ObjectId | string): Promise<IPublisherProfile | null> {
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    return PublisherProfileModel.findOne({ userId: uId });
  }

  static async createOrUpdatePublisherProfile(
    userId: Types.ObjectId | string,
    data: { displayName: string; description?: string; verified?: boolean },
  ): Promise<IPublisherProfile> {
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    let profile = await PublisherProfileModel.findOne({ userId: uId });
    if (profile) {
      profile.displayName = data.displayName.trim();
      if (data.description !== undefined) profile.description = data.description.trim();
      if (data.verified !== undefined) profile.verified = data.verified;
      await profile.save();
    } else {
      profile = await PublisherProfileModel.create({
        userId: uId,
        displayName: data.displayName.trim(),
        description: data.description?.trim(),
        verified: data.verified ?? false,
      });
    }

    return profile;
  }
}

import { Types } from 'mongoose';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { createAuditLog } from './auditService.js';

export interface TenantSettings {
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    accentColor?: string;
    companyName?: string;
    customDomain?: string;
  };
  security?: {
    mfaRequired?: boolean;
    sessionTimeoutMinutes?: number;
    ipAllowlist?: string[];
    enforceSSO?: boolean;
  };
  dataExport?: {
    allowedFormats?: string[];
    scheduledExport?: boolean;
  };
  integrations?: {
    apiEnabled?: boolean;
    webhooksEnabled?: boolean;
  };
}

export class TenantManagementService {
  /**
   * Get tenant/workspace settings and overview
   */
  async getTenantSettings(workspaceId: Types.ObjectId | string) {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    const workspace = await WorkspaceModel.findById(wsId).populate('ownerId', 'name email');
    if (!workspace) {
      throw new Error('Tenant workspace not found');
    }

    const memberCount = await WorkspaceMemberModel.countDocuments({ workspaceId: wsId });
    const workflowCount = await WorkflowModel.countDocuments({ workspaceId: wsId });
    const subscription = await SubscriptionModel.findOne({ workspaceId: wsId });

    return {
      workspace: {
        id: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description,
        owner: workspace.ownerId,
        status: workspace.status,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
      settings: (workspace.settings as TenantSettings) || {
        branding: {
          logoUrl: '',
          primaryColor: '#4f46e5',
          companyName: workspace.name,
        },
        security: {
          mfaRequired: false,
          sessionTimeoutMinutes: 1440,
          ipAllowlist: [],
        },
        dataExport: {
          allowedFormats: ['json', 'csv'],
        },
        integrations: {
          apiEnabled: true,
          webhooksEnabled: true,
        },
      },
      statistics: {
        memberCount,
        workflowCount,
        plan: subscription?.plan || 'FREE',
        subscriptionStatus: subscription?.status || 'ACTIVE',
      },
    };
  }

  /**
   * Update tenant branding, security and administrative settings
   */
  async updateTenantSettings(
    workspaceId: Types.ObjectId | string,
    updates: Partial<TenantSettings> & { name?: string; description?: string },
    userId: Types.ObjectId | string
  ) {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const workspace = await WorkspaceModel.findById(wsId);
    if (!workspace) {
      throw new Error('Tenant workspace not found');
    }

    if (updates.name) workspace.name = updates.name;
    if (updates.description !== undefined) workspace.description = updates.description;

    const currentSettings = (workspace.settings as Record<string, any>) || {};
    const newSettings = {
      ...currentSettings,
      branding: { ...(currentSettings.branding || {}), ...(updates.branding || {}) },
      security: { ...(currentSettings.security || {}), ...(updates.security || {}) },
      dataExport: { ...(currentSettings.dataExport || {}), ...(updates.dataExport || {}) },
      integrations: { ...(currentSettings.integrations || {}), ...(updates.integrations || {}) },
    };

    workspace.settings = newSettings;
    workspace.markModified('settings');
    await workspace.save();

    await createAuditLog({
      action: 'TENANT_SETTINGS_UPDATED',
      workspaceId: wsId,
      resource: 'tenant',
      resourceId: wsId.toString(),
      userId: uId,
      metadata: { updates },
    });

    return this.getTenantSettings(wsId);
  }

  /**
   * Export all tenant data (workflows, templates, metadata) in JSON or CSV
   */
  async exportTenantData(workspaceId: Types.ObjectId | string, format: 'json' | 'csv' = 'json') {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    const workspace = await WorkspaceModel.findById(wsId).lean();
    if (!workspace) {
      throw new Error('Tenant workspace not found');
    }

    const workflows = await WorkflowModel.find({ workspaceId: wsId }).lean();
    const members = await WorkspaceMemberModel.find({ workspaceId: wsId }).populate('userId', 'email name').lean();
    const templates = await WorkflowTemplateModel.find({ workspaceId: wsId }).lean();

    const exportData = {
      exportedAt: new Date().toISOString(),
      tenant: {
        id: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
        status: workspace.status,
        settings: workspace.settings,
      },
      summary: {
        workflowsCount: workflows.length,
        membersCount: members.length,
        templatesCount: templates.length,
      },
      workflows: workflows.map((w: any) => ({
        id: w._id.toString(),
        name: w.name,
        description: w.description,
        version: w.version,
        triggers: w.triggers,
        nodesCount: w.nodes?.length || 0,
        createdAt: w.createdAt,
      })),
      templates: templates.map((t: any) => ({
        id: t._id.toString(),
        name: t.name,
        category: t.category,
        visibility: t.visibility,
        status: t.status,
      })),
      members: members.map((m: any) => ({
        id: m._id.toString(),
        userId: m.userId?._id?.toString(),
        email: (m.userId as any)?.email,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    };

    if (format === 'csv') {
      // Return a basic CSV string of workflows
      const headers = 'ID,Name,Description,Version,NodesCount,CreatedAt\n';
      const rows = exportData.workflows
        .map(
          (w) =>
            `"${w.id}","${w.name.replace(/"/g, '""')}","${(w.description || '').replace(/"/g, '""')}",${w.version},${w.nodesCount},"${w.createdAt}"`
        )
        .join('\n');
      return { format: 'csv', contentType: 'text/csv', data: headers + rows };
    }

    return { format: 'json', contentType: 'application/json', data: exportData };
  }

  /**
   * Delete or terminate a tenant workspace
   */
  async deleteTenant(workspaceId: Types.ObjectId | string, userId: Types.ObjectId | string) {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const workspace = await WorkspaceModel.findById(wsId);
    if (!workspace) {
      throw new Error('Tenant workspace not found');
    }

    workspace.status = 'DELETED';
    await workspace.save();

    // Update subscriptions
    await SubscriptionModel.updateMany({ workspaceId: wsId }, { status: 'CANCELLED' });

    await createAuditLog({
      action: 'TENANT_DELETED',
      workspaceId: wsId,
      resource: 'tenant',
      resourceId: wsId.toString(),
      userId: uId,
      metadata: { name: workspace.name, slug: workspace.slug },
    });

    return { message: 'Tenant workspace scheduled for deletion and marked DELETED' };
  }

  /**
   * Get workspace hierarchy
   */
  async getWorkspaceHierarchy(workspaceId: Types.ObjectId | string) {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const workspace = await WorkspaceModel.findById(wsId).lean();
    if (!workspace) {
      throw new Error('Tenant workspace not found');
    }

    return {
      tenantId: workspace._id.toString(),
      name: workspace.name,
      slug: workspace.slug,
      parent: null,
      children: [],
    };
  }
}

export const tenantManagementService = new TenantManagementService();

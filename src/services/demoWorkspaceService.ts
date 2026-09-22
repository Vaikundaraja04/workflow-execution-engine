import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { AuthConfig } from '../auth/jwt.service.js';
import { issueTokens } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.service.js';
import { permissionsForRole } from '../auth/permissions.js';
import { UserModel } from '../models/UserModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import type { IWorkspace } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { CustomerProfileModel } from '../models/CustomerProfileModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AgentModel } from '../models/AgentModel.js';
import { AgentRunModel } from '../models/AgentRunModel.js';
import { billingService } from './billingService.js';
import { createWorkflow } from './workflowService.js';
import { createAuditLog } from './auditService.js';
import { errorFields, logger } from '../observability/logger.js';
import { productPackagingService } from './productPackagingService.js';
import { isPlatformAdminEmail } from '../api/middleware/platformAdmin.js';
import type { WorkflowDefinition } from '../types/workflow.js';

export const DEFAULT_DEMO_TTL_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;

function readDemoTtlHours(): number {
  const raw = Number(process.env.DEMO_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(720, Math.floor(raw)) : DEFAULT_DEMO_TTL_HOURS;
}

function isDemoWorkspace(workspace: { settings?: Record<string, unknown> | undefined }): boolean {
  return workspace.settings?.demo === true;
}
const DEMO_WORKFLOWS: Array<{ name: string; definition: WorkflowDefinition }> = [
  {
    name: 'Demo: inbound webhook',
    definition: {
      nodes: [
        { id: 'trigger', type: 'webhook', config: {} },
        { id: 'note', type: 'log', config: { message: 'Inbound payload received' } },
      ],
      edges: [{ source: 'trigger', target: 'note' }],
    },
  },
  {
    name: 'Demo: approval routing',
    definition: {
      nodes: [
        { id: 'trigger', type: 'webhook', config: {} },
        { id: 'check', type: 'condition', config: { field: 'amount', operator: 'greaterThan', value: 500 } },
        { id: 'approve', type: 'log', config: { message: 'Escalated for approval' } },
        { id: 'auto', type: 'log', config: { message: 'Processed automatically' } },
      ],
      edges: [
        { source: 'trigger', target: 'check' },
        { source: 'check', target: 'approve', condition: 'true' },
        { source: 'check', target: 'auto', condition: 'false' },
      ],
    },
  },
];

export interface DemoCreateResult {
  workspaceId: string;
  tenantId: string;
  ownerUserId: string;
  demoExpiresAt: Date;
  workflowIds: string[];
  agentIds: string[];
  tokens: { accessToken: string; refreshToken: string };
}
export class DemoWorkspaceService {
  private timer: NodeJS.Timeout | null = null;
  private timerIntervalMs: number | null = null;

  async create(
    config: AuthConfig,
    options: { ttlHours?: number | undefined; ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<DemoCreateResult> {
    const suffix = randomUUID().slice(0, 8);
    const ttlHours = options.ttlHours ?? readDemoTtlHours();
    const demoExpiresAt = new Date(Date.now() + ttlHours * HOUR_MS);
    const email = `demo-${suffix}@demo.local`;
    const password = randomUUID();

    const user = await UserModel.create({
      email,
      passwordHash: await hashPassword(password),
    });

    const workspace = await WorkspaceModel.create({
      name: `Demo ${suffix}`,
      slug: `demo-${suffix}`,
      ownerId: user._id,
      status: 'ACTIVE',
      settings: { demo: true, demoExpiresAt },
    });

    await WorkspaceMemberModel.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: 'OWNER',
      permissions: permissionsForRole('OWNER'),
      status: 'ACTIVE',
    });

    const tenant = await TenantAccountModel.create({
      workspaceId: workspace._id,
      ownerUserId: user._id,
      companyName: `Demo Tenant ${suffix}`,
      status: 'TRIALING',
      plan: 'FREE',
      region: (process.env.REGION ?? 'us-east-1').trim(),
      trialEndsAt: demoExpiresAt,
      demo: true,
      useCase: 'Sandbox evaluation',
      onboarding: { completed: true, steps: ['company', 'use_case', 'templates'], startedAt: new Date(), completedAt: new Date() },
    });

    await CustomerProfileModel.create({
      tenantId: workspace._id,
      contactName: 'Demo User',
      contactEmail: email,
      company: `Demo Tenant ${suffix}`,
    });
    await billingService.subscribeWorkspace(
      workspace._id,
      'FREE',
      undefined,
      { trialDays: Math.max(1, Math.ceil(ttlHours / 24)) },
    );

    const seeded = await this.seedContent(workspace, user._id);
    const packaging = await productPackagingService.packageWorkspace('STARTER', 'Sandbox evaluation');

    const tokens = await issueTokens(config, user._id, email, {
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });

    await createAuditLog({
      action: 'DEMO_WORKSPACE_CREATED',
      userId: user._id,
      workspaceId: workspace._id,
      resource: 'workspace',
      resourceId: workspace._id.toString(),
      metadata: {
        demoExpiresAt: demoExpiresAt.toISOString(),
        ttlHours,
        workflows: seeded.workflowIds.length,
        agents: seeded.agentIds.length,
      },
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });

    return {
      workspaceId: workspace._id.toString(),
      tenantId: tenant._id.toString(),
      ownerUserId: user._id.toString(),
      demoExpiresAt,
      workflowIds: seeded.workflowIds,
      agentIds: seeded.agentIds,
      tokens,
    };
  }

  private async seedContent(
    workspace: IWorkspace,
    ownerId: Types.ObjectId,
  ): Promise<{ workflowIds: string[]; agentIds: string[] }> {
    const workflowIds: string[] = [];
    for (const template of DEMO_WORKFLOWS) {
      try {
        const workflow = await createWorkflow(
          template.name,
          template.definition,
          ownerId.toString(),
          workspace._id.toString(),
        );
        workflowIds.push(workflow._id.toString());
      } catch (error) {
        logger.warn('demo_workflow_seed_failed', errorFields(error));
      }
    }

    const agentIds: string[] = [];
    try {
      const agent = await AgentModel.create({
        workspaceId: workspace._id,
        name: 'Demo assistant',
        description: 'Sample agent seeded for the demo sandbox',
        systemPrompt: 'You triage inbound requests and summarize the next action.',
        modelConfig: { provider: 'mock', temperature: 0.2, maxTokens: 500, maxTurns: 3 },
        orchestrationMode: 'sequential',
        toolsAllowed: [],
        requiredPermissions: [],
        memoryEnabled: false,
        status: 'ACTIVE',
        createdBy: ownerId,
      });
      agentIds.push(agent._id.toString());
    } catch (error) {
      logger.warn('demo_agent_seed_failed', errorFields(error));
    }

    return { workflowIds, agentIds };
  }
  async reset(
    workspaceId: Types.ObjectId | string,
    userId: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const workspace = await WorkspaceModel.findById(workspaceIdObj);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    if (!isDemoWorkspace(workspace)) throw new Error('NOT_DEMO_TENANT');
    const isOwner = workspace.ownerId.toString() === userId;
    if (!isOwner && !(await this.isRequestorPlatformAdmin(userId))) {
      throw new Error('FORBIDDEN');
    }

    await Promise.all([
      WorkflowModel.deleteMany({ workspaceId: workspaceIdObj }),
      WorkflowExecutionModel.deleteMany({ workspaceId: workspaceIdObj }),
      AgentModel.deleteMany({ workspaceId: workspaceIdObj }),
      AgentRunModel.deleteMany({ workspaceId: workspaceIdObj }),
    ]);

    const seeded = await this.seedContent(workspace, workspace.ownerId);
    const demoExpiresAt = new Date(Date.now() + readDemoTtlHours() * HOUR_MS);
    workspace.settings = { ...(workspace.settings ?? {}), demo: true, demoExpiresAt };
    await workspace.save();
    await TenantAccountModel.updateOne(
      { workspaceId: workspaceIdObj },
      { $set: { trialEndsAt: demoExpiresAt } },
    );

    await createAuditLog({
      action: 'DEMO_WORKSPACE_RESET',
      userId,
      workspaceId: workspaceIdObj,
      resource: 'workspace',
      resourceId: workspaceIdObj.toString(),
      metadata: {
        demoExpiresAt: demoExpiresAt.toISOString(),
        workflows: seeded.workflowIds.length,
        agents: seeded.agentIds.length,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      workspaceId: workspaceIdObj.toString(),
      workflows: seeded.workflowIds,
      agents: seeded.agentIds,
      demoExpiresAt,
    };
  }

  private async isRequestorPlatformAdmin(userId: string): Promise<boolean> {
    const user = await UserModel.findById(userId).select('email').lean();
    return user?.email ? isPlatformAdminEmail(user.email) : false;
  }
  async expireStale(options: { now?: Date } = {}) {
    const now = options.now ?? new Date();
    const staleWorkspaces = await WorkspaceModel.find({
      'settings.demo': true,
      'settings.demoExpiresAt': { $lte: now },
      status: { $ne: 'DELETED' },
    });

    let expired = 0;
    for (const workspace of staleWorkspaces) {
      try {
        await Promise.all([
          WorkflowModel.deleteMany({ workspaceId: workspace._id }),
          WorkflowExecutionModel.deleteMany({ workspaceId: workspace._id }),
          AgentModel.deleteMany({ workspaceId: workspace._id }),
          AgentRunModel.deleteMany({ workspaceId: workspace._id }),
        ]);
        await WorkspaceModel.updateOne({ _id: workspace._id }, { $set: { status: 'DELETED' } });
        await TenantAccountModel.updateOne(
          { workspaceId: workspace._id },
          { $set: { status: 'CLOSED' } },
        );
        expired += 1;
      } catch (error) {
        logger.warn('demo_workspace_expiry_failed', errorFields(error));
      }
    }
    return { expired };
  }

  startScheduler(): { started: boolean; intervalMs: number | null } {
    if (this.timer) return { started: false, intervalMs: this.timerIntervalMs };
    const raw = Number(process.env.DEMO_RESET_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < 60_000) return { started: false, intervalMs: null };
    const intervalMs = Math.floor(raw);
    this.timer = setInterval(() => {
      void this.expireStale().catch((error) => {
        logger.warn('demo_expiry_sweep_failed', errorFields(error));
      });
    }, intervalMs);
    this.timer.unref();
    this.timerIntervalMs = intervalMs;
    logger.info('demo_expiry_scheduler_started', { intervalMs });
    return { started: true, intervalMs };
  }

  stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.timerIntervalMs = null;
  }
}

export const demoWorkspaceService = new DemoWorkspaceService();

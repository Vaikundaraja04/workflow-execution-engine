import { Types } from 'mongoose';
import type { AuthConfig } from '../auth/jwt.service.js';
import { issueTokens, registerUser } from '../auth/auth.service.js';
import type { IssuedTokens } from '../auth/auth.service.js';
import { createWorkspace } from './workspaceService.js';
import { createWorkflow } from './workflowService.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { UserModel } from '../models/UserModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import type { TenantStatus } from '../models/TenantAccountModel.js';
import { CustomerProfileModel } from '../models/CustomerProfileModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionPlan } from '../models/SubscriptionModel.js';
import { billingService } from './billingService.js';
import { usageMeteringService } from './usageMeteringService.js';
import { createAuditLog } from './auditService.js';
import { productPackagingService } from './productPackagingService.js';
import { customerHealthService } from './customerHealthService.js';
import { emailNotificationService } from './notifications/emailNotificationService.js';
import type { WorkflowDefinition } from '../types/workflow.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SIGNUP_TRIAL_DAYS = 14;

function readSignupTrialDays(): number {
  const raw = Number(process.env.SAAS_TRIAL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(90, Math.floor(raw)) : DEFAULT_SIGNUP_TRIAL_DAYS;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 11000;
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  companyName: string;
  workspaceName?: string | undefined;
  useCase?: string | undefined;
  plan?: SubscriptionPlan | undefined;
  trialDays?: number | undefined;
  region?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}
export interface SignupResult {
  user: { id: string; email: string };
  workspace: { id: string; name: string; slug: string };
  tenant: {
    id: string;
    status: TenantStatus;
    plan: SubscriptionPlan;
    trialEndsAt: Date | null;
  };
  subscriptionId: string | null;
  starterWorkflowIds: string[];
  tokens: IssuedTokens;
}

export interface OnboardingInput {
  steps?: string[] | undefined;
  completed?: boolean | undefined;
}

export interface OnboardingResult {
  steps: string[];
  completed: boolean;
  completedAt: Date | null;
}

const STARTER_WORKFLOWS: Array<{ name: string; definition: WorkflowDefinition }> = [
  {
    name: 'Welcome webhook',
    definition: {
      nodes: [
        { id: 'trigger', type: 'webhook', config: {} },
        { id: 'note', type: 'log', config: { message: 'Workflow triggered via webhook' } },
      ],
      edges: [{ source: 'trigger', target: 'note' }],
    },
  },
  {
    name: 'Approval routing',
    definition: {
      nodes: [
        { id: 'trigger', type: 'webhook', config: {} },
        {
          id: 'check',
          type: 'condition',
          config: { field: 'amount', operator: 'greaterThan', value: 1000 },
        },
        { id: 'approve', type: 'log', config: { message: 'Manual approval required' } },
        { id: 'auto', type: 'log', config: { message: 'Auto-approved' } },
      ],
      edges: [
        { source: 'trigger', target: 'check' },
        { source: 'check', target: 'approve', condition: 'true' },
        { source: 'check', target: 'auto', condition: 'false' },
      ],
    },
  },
];
export class SaasOnboardingService {
  async signup(input: SignupInput, config: AuthConfig): Promise<SignupResult> {
    const plan: SubscriptionPlan = input.plan ?? 'FREE';
    const trialDays = input.trialDays ?? readSignupTrialDays();
    const user = await registerUser(input.email.trim().toLowerCase(), input.password);

    const workspaceView = await createWorkspace(user._id.toString(), {
      name: (input.workspaceName ?? input.companyName).trim(),
    });
    const workspaceId = new Types.ObjectId(workspaceView.id);
    const trialEndsAt = new Date(Date.now() + trialDays * DAY_MS);

    const tenant = await TenantAccountModel.create({
      workspaceId,
      ownerUserId: user._id,
      companyName: input.companyName.trim(),
      status: 'TRIALING',
      plan,
      region: (input.region ?? process.env.REGION ?? 'us-east-1').trim(),
      trialEndsAt,
      demo: false,
      useCase: input.useCase?.trim() ?? null,
      onboarding: { completed: false, steps: [], startedAt: new Date() },
    });

    await CustomerProfileModel.create({
      tenantId: workspaceId,
      contactName: input.name.trim(),
      contactEmail: input.email.trim().toLowerCase(),
      company: input.companyName.trim(),
    });

    const subscription = await billingService.subscribeWorkspace(workspaceId, plan, undefined, { trialDays });
    tenant.subscriptionId = subscription?._id ?? null;
    await tenant.save();

    await WorkspaceModel.updateOne(
      { _id: workspaceId },
      { $set: { settings: { timezone: 'UTC', locale: 'en' } } },
    );
    const starterWorkflowIds: string[] = [];
    for (const starter of STARTER_WORKFLOWS) {
      try {
        const workflow = await createWorkflow(
          starter.name,
          starter.definition,
          user._id.toString(),
          workspaceId.toString(),
        );
        starterWorkflowIds.push(workflow._id.toString());
      } catch (error) {
        console.warn('Failed to install starter workflow during signup', error);
      }
    }

    await usageMeteringService.syncFromSources(workspaceId).catch(() => []);

    const tokens = await issueTokens(config, user._id, user.email, {
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await createAuditLog({
      action: 'SAAS_SIGNUP_COMPLETED',
      userId: user._id,
      workspaceId,
      resource: 'tenant_account',
      resourceId: tenant._id.toString(),
      metadata: {
        plan,
        tenantStatus: tenant.status,
        trialDays,
        companyName: input.companyName.trim(),
        starterWorkflows: starterWorkflowIds.length,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    // Phase 15.6 - welcome email (never blocks signup).
    await emailNotificationService.sendSafely({
      to: user.email,
      template: 'WELCOME',
      workspaceId: workspaceId.toString(),
      userId: user._id.toString(),
      actorUserId: user._id.toString(),
      variables: {
        contactName: input.name?.trim() || user.email,
        companyName: input.companyName.trim(),
        workspaceName: workspaceView.name,
        onboardingUrl: `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/customer/onboarding`,
      },
    });

    return {
      user: { id: user._id.toString(), email: user.email },
      workspace: { id: workspaceView.id, name: workspaceView.name, slug: workspaceView.slug },
      tenant: {
        id: tenant._id.toString(),
        status: tenant.status,
        plan: tenant.plan,
        trialEndsAt: tenant.trialEndsAt ?? null,
      },
      subscriptionId: subscription?._id?.toString() ?? null,
      starterWorkflowIds,
      tokens,
    };
  }
  /**
   * Workspaces created before the SaaS signup flow (or through the standard
   * auth registration) have no tenant record. Provision a FREE trialing
   * tenant on first access so the customer console works for them instead of
   * failing with TENANT_NOT_FOUND.
   */
  private async ensureTenantAccount(workspaceIdObj: Types.ObjectId) {
    const existing = await TenantAccountModel.findOne({ workspaceId: workspaceIdObj });
    if (existing) return existing;

    const workspace = await WorkspaceModel.findById(workspaceIdObj).select('name ownerId').lean();
    if (!workspace) throw new Error('TENANT_NOT_FOUND');
    const owner = await UserModel.findById(workspace.ownerId).select('email').lean();

    const trialDays = readSignupTrialDays();
    const trialEndsAt = new Date(Date.now() + trialDays * DAY_MS);

    let tenant;
    try {
      tenant = await TenantAccountModel.create({
        workspaceId: workspaceIdObj,
        ownerUserId: workspace.ownerId,
        companyName: workspace.name,
        status: 'TRIALING',
        plan: 'FREE',
        region: (process.env.REGION ?? 'us-east-1').trim(),
        trialEndsAt,
        demo: false,
        onboarding: { completed: false, steps: [], startedAt: new Date() },
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const concurrent = await TenantAccountModel.findOne({ workspaceId: workspaceIdObj });
        if (concurrent) return concurrent;
      }
      throw error;
    }

    await CustomerProfileModel.updateOne(
      { tenantId: workspaceIdObj },
      {
        $setOnInsert: {
          contactName: owner?.email ?? 'Workspace owner',
          contactEmail: owner?.email ?? 'unknown@example.com',
          company: workspace.name,
        },
      },
      { upsert: true },
    ).catch((error) => console.warn('Failed to provision customer profile for legacy workspace', error));

    try {
      const subscription = await billingService.subscribeWorkspace(workspaceIdObj, 'FREE', undefined, { trialDays });
      tenant.subscriptionId = subscription?._id ?? null;
      await tenant.save();
    } catch (error) {
      console.warn('Failed to provision default subscription for legacy workspace', error);
    }

    await createAuditLog({
      action: 'TENANT_AUTO_PROVISIONED',
      userId: workspace.ownerId.toString(),
      workspaceId: workspaceIdObj,
      resource: 'tenant_account',
      resourceId: tenant._id.toString(),
      metadata: { plan: 'FREE', trialDays, reason: 'legacy_workspace' },
    }).catch((error) => console.warn('Failed to audit tenant auto-provisioning', error));

    return tenant;
  }

  async recordOnboarding(
    workspaceId: Types.ObjectId | string,
    userId: string,
    input: OnboardingInput,
  ): Promise<OnboardingResult> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const tenant = await this.ensureTenantAccount(workspaceIdObj);

    if (input.steps !== undefined) {
      tenant.onboarding.steps = input.steps.filter((step) => typeof step === 'string' && step.length > 0);
    }
    if (input.completed !== undefined) {
      tenant.onboarding.completed = input.completed;
      tenant.onboarding.completedAt = input.completed ? new Date() : null;
    }
    await tenant.save();

    if (input.completed === true) {
      await createAuditLog({
        action: 'SAAS_ONBOARDING_COMPLETED',
        userId,
        workspaceId: workspaceIdObj,
        resource: 'tenant_account',
        resourceId: tenant._id.toString(),
        metadata: { steps: tenant.onboarding.steps },
      });
    }

    return {
      steps: tenant.onboarding.steps,
      completed: tenant.onboarding.completed,
      completedAt: tenant.onboarding.completedAt ?? null,
    };
  }
  async getAccount(workspaceId: Types.ObjectId | string) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const tenant = await this.ensureTenantAccount(workspaceIdObj);
    const [profile, subscription, usage] = await Promise.all([
      CustomerProfileModel.findOne({ tenantId: workspaceIdObj }).lean(),
      SubscriptionModel.findOne({ workspaceId: workspaceIdObj }).lean(),
      usageMeteringService.getSummary(workspaceIdObj),
    ]);

    return {
      tenant: {
        id: tenant._id.toString(),
        workspaceId: tenant.workspaceId.toString(),
        companyName: tenant.companyName,
        status: tenant.status,
        plan: tenant.plan,
        region: tenant.region,
        trialEndsAt: tenant.trialEndsAt ?? null,
        demo: tenant.demo,
        useCase: tenant.useCase ?? null,
        onboarding: {
          completed: tenant.onboarding.completed,
          steps: tenant.onboarding.steps,
          startedAt: tenant.onboarding.startedAt,
          completedAt: tenant.onboarding.completedAt ?? null,
        },
      },
      profile: profile
        ? {
            contactName: profile.contactName,
            contactEmail: profile.contactEmail,
            contactPhone: profile.contactPhone ?? null,
            company: profile.company,
            billingAddress: profile.billingAddress ?? null,
            taxId: profile.taxId ?? null,
            timezone: profile.timezone,
            locale: profile.locale,
          }
        : null,
      subscription: subscription
        ? {
            id: subscription._id.toString(),
            plan: subscription.plan,
            status: subscription.status,
            billingProvider: subscription.billingProvider,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEndsAt: subscription.trialEndsAt ?? null,
          }
        : null,
      usage,
    };
  }
}

export const saasOnboardingService = new SaasOnboardingService();

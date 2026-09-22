import { Types } from 'mongoose';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import type { TenantStatus } from '../models/TenantAccountModel.js';
import { CustomerProfileModel } from '../models/CustomerProfileModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import type { WorkspaceStatus } from '../models/WorkspaceModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionPlan, SubscriptionStatus } from '../models/SubscriptionModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { UsageMeterModel } from '../models/UsageMeterModel.js';
import { monthPeriodKey } from './usageMeteringService.js';
import { createAuditLog } from './auditService.js';
import { productPackagingService } from './productPackagingService.js';
import { customerHealthService } from './customerHealthService.js';

export interface CustomerListFilters {
  status?: TenantStatus | undefined;
  plan?: SubscriptionPlan | undefined;
  demo?: boolean | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** @deprecated use CustomerHealthReport from customerHealthService */
export interface CustomerHealth {
  score: number;
  band: 'healthy' | 'watch' | 'at_risk';
  factors: { subscription: number; usagePressure: number; activity: number };
}

function computeHealth(
  subscriptionStatus: SubscriptionStatus | null,
  maxUsagePercent: number,
  lastActivityAt: Date | null,
): CustomerHealth {
  const subscription = subscriptionStatus === 'ACTIVE' || subscriptionStatus === 'TRIALING'
    ? 100
    : subscriptionStatus === 'PAST_DUE'
      ? 40
      : subscriptionStatus
        ? 10
        : 50;
  const usagePressure = maxUsagePercent >= 100 ? 20 : maxUsagePercent >= 80 ? 60 : 100;
  const idleDays = lastActivityAt ? (Date.now() - lastActivityAt.getTime()) / (24 * 60 * 60 * 1000) : Infinity;
  const activity = idleDays <= 7 ? 100 : idleDays <= 30 ? 70 : 40;
  const score = Math.round(subscription * 0.5 + usagePressure * 0.3 + activity * 0.2);
  const band = score >= 70 ? 'healthy' : score >= 40 ? 'watch' : 'at_risk';
  return { score, band, factors: { subscription, usagePressure, activity } };
}
export interface CustomerRow {
  tenantId: string;
  workspaceId: string;
  companyName: string;
  status: TenantStatus;
  workspaceStatus: WorkspaceStatus | null;
  plan: SubscriptionPlan;
  region: string;
  demo: boolean;
  createdAt: Date;
  subscription: {
    status: SubscriptionStatus;
    billingProvider: string;
    currentPeriodEnd: Date;
    trialEndsAt: Date | null;
  } | null;
  usage: {
    executionsThisMonth: number;
    storageBytes: number;
    warningMetrics: string[];
    exceededMetrics: string[];
  };
  health: CustomerHealth;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export class CustomerManagementService {
  async listCustomers(filters: CustomerListFilters = {}): Promise<{
    customers: CustomerRow[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0
      ? Math.min(200, Math.floor(filters.limit))
      : 50;
    const offset = Number.isFinite(filters.offset) && filters.offset && filters.offset >= 0
      ? Math.floor(filters.offset)
      : 0;

    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.plan) query.plan = filters.plan;
    if (filters.demo !== undefined) query.demo = filters.demo;
    if (filters.search) {
      query.companyName = { $regex: escapeRegExp(filters.search.trim()), $options: 'i' };
    }

    const [tenants, total] = await Promise.all([
      TenantAccountModel.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      TenantAccountModel.countDocuments(query),
    ]);

    const workspaceIds = tenants.map((tenant) => tenant.workspaceId);
    const monthKey = monthPeriodKey(new Date());
    const [workspaces, subscriptions, usageDocs, meters] = await Promise.all([
      WorkspaceModel.find({ _id: { $in: workspaceIds } }).select('status').lean(),
      SubscriptionModel.find({ workspaceId: { $in: workspaceIds } }).lean(),
      WorkspaceUsageModel.find({ workspaceId: { $in: workspaceIds } }).lean(),
      UsageMeterModel.find({
        workspaceId: { $in: workspaceIds },
        granularity: 'MONTH',
        periodKey: monthKey,
      }).lean(),
    ]);

    const workspaceById = new Map(workspaces.map((workspace) => [workspace._id.toString(), workspace]));
    const subscriptionByWorkspace = new Map(
      subscriptions.map((subscription) => [subscription.workspaceId.toString(), subscription]),
    );
    const usageByWorkspace = new Map(usageDocs.map((usage) => [usage.workspaceId.toString(), usage]));
    const metersByWorkspace = new Map<string, typeof meters>();
    for (const meter of meters) {
      const key = meter.workspaceId.toString();
      const list = metersByWorkspace.get(key) ?? [];
      list.push(meter);
      metersByWorkspace.set(key, list);
    }
    const customers: CustomerRow[] = tenants.map((tenant) => {
      const workspaceId = tenant.workspaceId.toString();
      const workspace = workspaceById.get(workspaceId);
      const subscription = subscriptionByWorkspace.get(workspaceId);
      const usageDoc = usageByWorkspace.get(workspaceId);
      const workspaceMeters = metersByWorkspace.get(workspaceId) ?? [];
      const warningMetrics = workspaceMeters.filter((m) => m.alertState === 'WARNING').map((m) => m.metric);
      const exceededMetrics = workspaceMeters.filter((m) => m.alertState === 'EXCEEDED').map((m) => m.metric);
      const maxPercent = workspaceMeters.reduce((max, m) => Math.max(max, m.percent), 0);
      const executionsThisMonth = workspaceMeters.find((m) => m.metric === 'EXECUTIONS')?.value ?? 0;

      return {
        tenantId: tenant._id.toString(),
        workspaceId,
        companyName: tenant.companyName,
        status: tenant.status,
        workspaceStatus: workspace?.status ?? null,
        plan: tenant.plan,
        region: tenant.region,
        demo: tenant.demo,
        createdAt: tenant.createdAt,
        subscription: subscription
          ? {
              status: subscription.status,
              billingProvider: subscription.billingProvider,
              currentPeriodEnd: subscription.currentPeriodEnd,
              trialEndsAt: subscription.trialEndsAt ?? null,
            }
          : null,
        usage: {
          executionsThisMonth,
          storageBytes: usageDoc?.storageUsed ?? 0,
          warningMetrics,
          exceededMetrics,
        },
        health: computeHealth(
          subscription?.status ?? null,
          maxPercent,
          usageDoc?.updatedAt ?? null,
        ),
      };
    });

    return { customers, total, limit, offset };
  }
  async getCustomerDetail(workspaceId: Types.ObjectId | string) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const [tenant, profile, workspace, subscription, usage] = await Promise.all([
      TenantAccountModel.findOne({ workspaceId: workspaceIdObj }).lean(),
      CustomerProfileModel.findOne({ tenantId: workspaceIdObj }).lean(),
      WorkspaceModel.findById(workspaceIdObj).lean(),
      SubscriptionModel.findOne({ workspaceId: workspaceIdObj }).lean(),
      WorkspaceUsageModel.findOne({ workspaceId: workspaceIdObj }).lean(),
    ]);
    if (!tenant) throw new Error('CUSTOMER_NOT_FOUND');

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
        onboarding: tenant.onboarding,
        createdAt: tenant.createdAt,
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
            supportNotes: profile.supportNotes,
          }
        : null,
      workspace: workspace
        ? {
            id: workspace._id.toString(),
            name: workspace.name,
            slug: workspace.slug,
            status: workspace.status,
            region: workspace.region ?? null,
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
      usage: usage
        ? {
            totalWorkflows: usage.totalWorkflows,
            monthlyExecutions: usage.monthlyExecutions,
            storageUsed: usage.storageUsed,
            updatedAt: usage.updatedAt,
          }
        : null,
    };
  }
  async suspend(
    workspaceId: Types.ObjectId | string,
    actorUserId: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const workspace = await WorkspaceModel.findById(workspaceIdObj);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

    const previousStatus = workspace.status;
    workspace.status = 'SUSPENDED';
    await workspace.save();

    await TenantAccountModel.updateOne(
      { workspaceId: workspaceIdObj },
      { $set: { status: 'SUSPENDED' } },
    );

    await createAuditLog({
      action: 'TENANT_SUSPENDED',
      userId: actorUserId,
      workspaceId: workspaceIdObj,
      resource: 'tenant_account',
      resourceId: workspaceIdObj.toString(),
      metadata: { previousStatus },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { workspaceId: workspaceIdObj.toString(), status: 'SUSPENDED' as const };
  }

  async reactivate(
    workspaceId: Types.ObjectId | string,
    actorUserId: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const workspace = await WorkspaceModel.findById(workspaceIdObj);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

    workspace.status = 'ACTIVE';
    await workspace.save();

    const tenant = await TenantAccountModel.findOne({ workspaceId: workspaceIdObj });
    const tenantStatus: TenantStatus = tenant?.trialEndsAt && tenant.trialEndsAt.getTime() > Date.now()
      ? 'TRIALING'
      : 'ACTIVE';
    await TenantAccountModel.updateOne(
      { workspaceId: workspaceIdObj },
      { $set: { status: tenantStatus } },
    );

    await createAuditLog({
      action: 'TENANT_REACTIVATED',
      userId: actorUserId,
      workspaceId: workspaceIdObj,
      resource: 'tenant_account',
      resourceId: workspaceIdObj.toString(),
      metadata: { tenantStatus },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { workspaceId: workspaceIdObj.toString(), status: 'ACTIVE' as const, tenantStatus };
  }
  async getCustomerHealth(workspaceId: string) {
    return customerHealthService.evaluate(workspaceId);
  }

  async getHealthPortfolio() {
    return customerHealthService.portfolio();
  }

  async addNote(
    workspaceId: Types.ObjectId | string,
    authorUserId: string,
    note: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const profile = await CustomerProfileModel.findOne({ tenantId: workspaceIdObj });
    if (!profile) throw new Error('CUSTOMER_NOT_FOUND');

    profile.supportNotes.push({
      authorUserId: new Types.ObjectId(authorUserId),
      note,
      createdAt: new Date(),
    });
    await profile.save();

    await createAuditLog({
      action: 'CUSTOMER_NOTE_ADDED',
      userId: authorUserId,
      workspaceId: workspaceIdObj,
      resource: 'customer_profile',
      resourceId: profile._id.toString(),
      metadata: { noteLength: note.length },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const created = profile.supportNotes[profile.supportNotes.length - 1];
    return {
      authorUserId: created?.authorUserId.toString() ?? authorUserId,
      note: created?.note ?? note,
      createdAt: created?.createdAt ?? new Date(),
    };
  }
}

export const customerManagementService = new CustomerManagementService();

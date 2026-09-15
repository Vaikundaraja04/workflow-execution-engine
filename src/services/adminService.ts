import { Types } from 'mongoose';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../models/WorkspaceMemberModel.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { UserModel } from '../models/UserModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { APIKeyModel } from '../models/APIKeyModel.js';
import { WebhookModel } from '../models/WebhookModel.js';
import { WebhookDeliveryModel } from '../models/WebhookDeliveryModel.js';
import { DeadLetterModel } from '../models/DeadLetterModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { createAuditLog } from './auditService.js';
import {
  computeWorkspaceStorageBytes,
  recalculateAnalytics,
  monthKeyOf,
  getWorkspaceAnalytics,
} from './analyticsService.js';
import type { AnalyticsRecalculationSummary } from '../types/analytics.js';
import { queryAuditLogs } from './auditQueryService.js';
import type { AuditQueryResult } from './auditQueryService.js';
import type { HealthChecks } from '../api/routes/healthRoutes.js';
import type { HealthCheckResult } from '../observability/health.js';

export interface AdminWorkspaceDetailView {
  id: string;
  name: string;
  slug: string;
  description?: string | undefined;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  ownerId: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  membersByRole: {
    owner: number;
    admin: number;
    editor: number;
    viewer: number;
  };
  workflowCount: number;
  executionCount: number;
  storageUsedBytes: number;
  apiKeyCount: number;
  webhookCount: number;
}

export interface AdminWorkspaceSummaryView {
  id: string;
  name: string;
  slug: string;
  description?: string | undefined;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  ownerId: string;
  role: WorkspaceRole;
  memberCount: number;
  workflowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceUsageMetricsView {
  workspaceId: string;
  workflows: {
    total: number;
    active: number;
    draft: number;
    archived: number;
  };
  executions: {
    total: number;
    successful: number;
    failed: number;
    monthly: number;
    successRate: number;
    averageDurationMs: number;
  };
  storage: {
    totalBytes: number;
    formatted: string;
  };
  members: {
    total: number;
    active: number;
    invited: number;
    byRole: {
      owner: number;
      admin: number;
      editor: number;
      viewer: number;
    };
  };
  apiKeys: {
    total: number;
    active: number;
    revoked: number;
  };
  webhooks: {
    total: number;
    active: number;
    disabled: number;
  };
  period: string;
}

export interface QuotaItem {
  limit: number;
  current: number;
  usedPercentage: number;
  status: 'OK' | 'WARNING' | 'EXCEEDED';
}

export interface WorkspaceQuotaView {
  workspaceId: string;
  quotas: {
    workflows: QuotaItem;
    monthlyExecutions: QuotaItem;
    storageBytes: QuotaItem;
    members: QuotaItem;
    apiKeys: QuotaItem;
    webhooks: QuotaItem;
  };
  isOverQuota: boolean;
  warnings: string[];
}

export interface SecurityOverviewView {
  workspaceId: string;
  score: number;
  status: 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';
  apiKeys: {
    total: number;
    active: number;
    revoked: number;
    expired: number;
    expiringSoon: number;
    withoutRateLimit: number;
    adminPermissions: number;
  };
  webhooks: {
    total: number;
    active: number;
    disabled: number;
    failing: number;
    totalDeliveries: number;
    failedDeliveries: number;
    failureRate: number;
  };
  access: {
    totalMembers: number;
    owners: number;
    admins: number;
    editors: number;
    viewers: number;
    pendingInvitations: number;
  };
  events: {
    failedLoginsLast7d: number;
    refreshReplaysLast7d: number;
    apiKeyRevocationsLast30d: number;
    apiKeyRotationsLast30d: number;
    totalSecurityEventsLast7d: number;
  };
  recommendations: Array<{
    id: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    description: string;
  }>;
}

export interface SystemHealthView {
  status: 'ok' | 'degraded' | 'unavailable';
  checks: {
    mongo: HealthCheckResult;
    redis: HealthCheckResult;
    worker: HealthCheckResult;
  };
  uptimeSeconds: number;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  timestamp: string;
}

export interface SystemMetricsView {
  users: number;
  workspaces: {
    total: number;
    active: number;
    suspended: number;
    deleted: number;
  };
  workflows: {
    total: number;
    active: number;
    draft: number;
    archived: number;
  };
  executions: {
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    pending: number;
  };
  deadLetters: number;
  apiKeys: {
    total: number;
    active: number;
  };
  webhooks: {
    total: number;
    active: number;
  };
  auditLogs: number;
  timestamp: string;
}

function assertValidId(id: string, errorCode = 'INVALID_WORKSPACE_ID'): void {
  if (!Types.ObjectId.isValid(id)) throw new Error(errorCode);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function calculateQuotaItem(current: number, limit: number): QuotaItem {
  const usedPercentage = limit > 0 ? Math.round((current / limit) * 10000) / 100 : 0;
  let status: 'OK' | 'WARNING' | 'EXCEEDED' = 'OK';
  if (usedPercentage >= 100) {
    status = 'EXCEEDED';
  } else if (usedPercentage >= 80) {
    status = 'WARNING';
  }
  return {
    limit,
    current,
    usedPercentage,
    status,
  };
}

async function findMembership(workspaceId: string, userId: string) {
  return WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    status: 'ACTIVE',
  });
}

// -------------------------------------------------------------
// 1. Workspace Administration
// -------------------------------------------------------------

export async function suspendWorkspace(
  workspaceId: string,
  actorUserId: string,
): Promise<AdminWorkspaceDetailView> {
  assertValidId(workspaceId);
  const membership = await findMembership(workspaceId, actorUserId);
  if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
  if (membership.role !== 'OWNER') throw new Error('FORBIDDEN');

  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const previousStatus = workspace.status;
  workspace.status = 'SUSPENDED';
  await workspace.save();

  await createAuditLog({
    action: 'WORKSPACE_UPDATED',
    userId: actorUserId,
    workspaceId,
    resource: 'workspace',
    resourceId: workspaceId,
    metadata: { change: 'suspend', previousStatus, newStatus: 'SUSPENDED' },
  });

  return getWorkspaceAdminDetail(workspaceId, actorUserId);
}

export async function unsuspendWorkspace(
  workspaceId: string,
  actorUserId: string,
): Promise<AdminWorkspaceDetailView> {
  assertValidId(workspaceId);
  const membership = await findMembership(workspaceId, actorUserId);
  if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
  if (membership.role !== 'OWNER') throw new Error('FORBIDDEN');

  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const previousStatus = workspace.status;
  workspace.status = 'ACTIVE';
  await workspace.save();

  await createAuditLog({
    action: 'WORKSPACE_UPDATED',
    userId: actorUserId,
    workspaceId,
    resource: 'workspace',
    resourceId: workspaceId,
    metadata: { change: 'unsuspend', previousStatus, newStatus: 'ACTIVE' },
  });

  return getWorkspaceAdminDetail(workspaceId, actorUserId);
}

export async function deleteWorkspace(
  workspaceId: string,
  actorUserId: string,
): Promise<AdminWorkspaceDetailView> {
  assertValidId(workspaceId);
  const membership = await findMembership(workspaceId, actorUserId);
  if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
  if (membership.role !== 'OWNER') throw new Error('FORBIDDEN');

  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const previousStatus = workspace.status;
  workspace.status = 'DELETED';
  await workspace.save();

  await createAuditLog({
    action: 'WORKSPACE_UPDATED',
    userId: actorUserId,
    workspaceId,
    resource: 'workspace',
    resourceId: workspaceId,
    metadata: { change: 'delete', previousStatus, newStatus: 'DELETED' },
  });

  return getWorkspaceAdminDetail(workspaceId, actorUserId);
}

export async function getWorkspaceAdminDetail(
  workspaceId: string,
  actorUserId: string,
): Promise<AdminWorkspaceDetailView> {
  assertValidId(workspaceId);
  const membership = await findMembership(workspaceId, actorUserId);
  if (!membership) throw new Error('WORKSPACE_NOT_FOUND');
  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
    throw new Error('FORBIDDEN');
  }

  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const wsObjectId = new Types.ObjectId(workspaceId);

  const [
    members,
    workflowCount,
    executionCount,
    storageUsedBytes,
    apiKeyCount,
    webhookCount,
  ] = await Promise.all([
    WorkspaceMemberModel.find({ workspaceId: wsObjectId, status: 'ACTIVE' }).lean(),
    WorkflowModel.countDocuments({ workspaceId: wsObjectId }),
    WorkflowExecutionModel.countDocuments({ workspaceId: wsObjectId }),
    computeWorkspaceStorageBytes(wsObjectId),
    APIKeyModel.countDocuments({ workspaceId: wsObjectId }),
    WebhookModel.countDocuments({ workspaceId: wsObjectId }),
  ]);

  const membersByRole = {
    owner: 0,
    admin: 0,
    editor: 0,
    viewer: 0,
  };

  for (const m of members) {
    if (m.role === 'OWNER') membersByRole.owner += 1;
    else if (m.role === 'ADMIN') membersByRole.admin += 1;
    else if (m.role === 'EDITOR') membersByRole.editor += 1;
    else if (m.role === 'VIEWER') membersByRole.viewer += 1;
  }

  return {
    id: workspace._id.toString(),
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    status: workspace.status,
    ownerId: workspace.ownerId.toString(),
    role: membership.role,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
    memberCount: members.length,
    membersByRole,
    workflowCount,
    executionCount,
    storageUsedBytes,
    apiKeyCount,
    webhookCount,
  };
}

export async function listAdminWorkspaces(
  actorUserId: string,
): Promise<AdminWorkspaceSummaryView[]> {
  assertValidId(actorUserId, 'INVALID_USER_ID');
  const userObjectId = new Types.ObjectId(actorUserId);

  const memberships = await WorkspaceMemberModel.find({
    userId: userObjectId,
    role: { $in: ['OWNER', 'ADMIN'] },
    status: 'ACTIVE',
  }).lean();

  if (memberships.length === 0) return [];

  const wsIds = memberships.map(m => m.workspaceId);
  const workspaces = await WorkspaceModel.find({ _id: { $in: wsIds } }).sort({ createdAt: -1 }).lean();

  const roleByWs = new Map<string, WorkspaceRole>();
  for (const m of memberships) {
    roleByWs.set(m.workspaceId.toString(), m.role);
  }

  const summaries: AdminWorkspaceSummaryView[] = await Promise.all(
    workspaces.map(async ws => {
      const wsObjectId = ws._id;
      const [memberCount, workflowCount] = await Promise.all([
        WorkspaceMemberModel.countDocuments({ workspaceId: wsObjectId, status: 'ACTIVE' }),
        WorkflowModel.countDocuments({ workspaceId: wsObjectId }),
      ]);

      return {
        id: ws._id.toString(),
        name: ws.name,
        slug: ws.slug,
        description: ws.description,
        status: ws.status,
        ownerId: ws.ownerId.toString(),
        role: roleByWs.get(ws._id.toString()) ?? 'VIEWER',
        memberCount,
        workflowCount,
        createdAt: ws.createdAt.toISOString(),
        updatedAt: ws.updatedAt.toISOString(),
      };
    }),
  );

  return summaries;
}

// -------------------------------------------------------------
// 2. Usage & Quotas
// -------------------------------------------------------------

export async function getWorkspaceUsageMetrics(
  workspaceId: string,
): Promise<WorkspaceUsageMetricsView> {
  assertValidId(workspaceId);
  const wsObjectId = new Types.ObjectId(workspaceId);

  const [
    workflows,
    executions,
    members,
    apiKeys,
    webhooks,
    usageDoc,
    storageBytes,
  ] = await Promise.all([
    WorkflowModel.aggregate([
      { $match: { workspaceId: wsObjectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WorkflowExecutionModel.aggregate([
      { $match: { workspaceId: wsObjectId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgDuration: { $avg: { $subtract: ['$finishedAt', '$startedAt'] } },
        },
      },
    ]),
    WorkspaceMemberModel.aggregate([
      { $match: { workspaceId: wsObjectId } },
      { $group: { _id: { status: '$status', role: '$role' }, count: { $sum: 1 } } },
    ]),
    APIKeyModel.aggregate([
      { $match: { workspaceId: wsObjectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WebhookModel.aggregate([
      { $match: { workspaceId: wsObjectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WorkspaceUsageModel.findOne({ workspaceId: wsObjectId }).lean(),
    computeWorkspaceStorageBytes(wsObjectId),
  ]);

  // Workflow breakdown
  let activeWorkflows = 0;
  let draftWorkflows = 0;
  let archivedWorkflows = 0;
  let totalWorkflows = 0;
  for (const item of workflows) {
    totalWorkflows += item.count;
    if (item._id === 'ACTIVE' || item._id === 'PUBLISHED') activeWorkflows += item.count;
    else if (item._id === 'DRAFT') draftWorkflows += item.count;
    else if (item._id === 'ARCHIVED') archivedWorkflows += item.count;
  }

  // Execution breakdown
  let totalExecutions = 0;
  let successfulExecutions = 0;
  let failedExecutions = 0;
  let durationSum = 0;
  let finishedCount = 0;
  for (const item of executions) {
    totalExecutions += item.count;
    if (item._id === 'SUCCEEDED') successfulExecutions = item.count;
    else if (item._id === 'FAILED') failedExecutions = item.count;
    if (item.avgDuration && (item._id === 'SUCCEEDED' || item._id === 'FAILED')) {
      durationSum += item.avgDuration * item.count;
      finishedCount += item.count;
    }
  }
  const averageDurationMs = finishedCount > 0 ? Math.round(durationSum / finishedCount) : 0;
  const successRate = totalExecutions > 0 ? Math.round((successfulExecutions / totalExecutions) * 10000) / 10000 : 0;

  // Member breakdown
  let totalMembers = 0;
  let activeMembers = 0;
  let invitedMembers = 0;
  const byRole = { owner: 0, admin: 0, editor: 0, viewer: 0 };
  for (const item of members) {
    totalMembers += item.count;
    if (item._id.status === 'ACTIVE') {
      activeMembers += item.count;
      if (item._id.role === 'OWNER') byRole.owner += item.count;
      else if (item._id.role === 'ADMIN') byRole.admin += item.count;
      else if (item._id.role === 'EDITOR') byRole.editor += item.count;
      else if (item._id.role === 'VIEWER') byRole.viewer += item.count;
    } else if (item._id.status === 'INVITED') {
      invitedMembers += item.count;
    }
  }

  // API keys breakdown
  let totalKeys = 0;
  let activeKeys = 0;
  let revokedKeys = 0;
  for (const item of apiKeys) {
    totalKeys += item.count;
    if (item._id === 'ACTIVE') activeKeys = item.count;
    else if (item._id === 'REVOKED') revokedKeys = item.count;
  }

  // Webhook breakdown
  let totalWebhooks = 0;
  let activeWebhooks = 0;
  let disabledWebhooks = 0;
  for (const item of webhooks) {
    totalWebhooks += item.count;
    if (item._id === 'ACTIVE') activeWebhooks = item.count;
    else if (item._id === 'DISABLED') disabledWebhooks = item.count;
  }

  return {
    workspaceId,
    workflows: {
      total: totalWorkflows,
      active: activeWorkflows,
      draft: draftWorkflows,
      archived: archivedWorkflows,
    },
    executions: {
      total: totalExecutions,
      successful: successfulExecutions,
      failed: failedExecutions,
      monthly: usageDoc?.monthlyExecutions ?? totalExecutions,
      successRate,
      averageDurationMs,
    },
    storage: {
      totalBytes: storageBytes,
      formatted: formatBytes(storageBytes),
    },
    members: {
      total: totalMembers,
      active: activeMembers,
      invited: invitedMembers,
      byRole,
    },
    apiKeys: {
      total: totalKeys,
      active: activeKeys,
      revoked: revokedKeys,
    },
    webhooks: {
      total: totalWebhooks,
      active: activeWebhooks,
      disabled: disabledWebhooks,
    },
    period: monthKeyOf(new Date()),
  };
}

export async function getWorkspaceQuotas(
  workspaceId: string,
): Promise<WorkspaceQuotaView> {
  assertValidId(workspaceId);
  const metrics = await getWorkspaceUsageMetrics(workspaceId);

  // Enterprise standard quota defaults
  const limits = {
    workflows: 100,
    monthlyExecutions: 10000,
    storageBytes: 100 * 1024 * 1024, // 100 MB
    members: 50,
    apiKeys: 20,
    webhooks: 15,
  };

  const quotas = {
    workflows: calculateQuotaItem(metrics.workflows.total, limits.workflows),
    monthlyExecutions: calculateQuotaItem(metrics.executions.monthly, limits.monthlyExecutions),
    storageBytes: calculateQuotaItem(metrics.storage.totalBytes, limits.storageBytes),
    members: calculateQuotaItem(metrics.members.total, limits.members),
    apiKeys: calculateQuotaItem(metrics.apiKeys.active, limits.apiKeys),
    webhooks: calculateQuotaItem(metrics.webhooks.active, limits.webhooks),
  };

  const warnings: string[] = [];
  let isOverQuota = false;

  for (const [key, item] of Object.entries(quotas)) {
    if (item.status === 'EXCEEDED') {
      isOverQuota = true;
      warnings.push(`Quota exceeded for ${key}: ${item.current} / ${item.limit} (${item.usedPercentage}%)`);
    } else if (item.status === 'WARNING') {
      warnings.push(`Quota near limit for ${key}: ${item.current} / ${item.limit} (${item.usedPercentage}%)`);
    }
  }

  return {
    workspaceId,
    quotas,
    isOverQuota,
    warnings,
  };
}

// -------------------------------------------------------------
// 3. Security Center
// -------------------------------------------------------------

export async function getSecurityOverview(
  workspaceId: string,
): Promise<SecurityOverviewView> {
  assertValidId(workspaceId);
  const wsObjectId = new Types.ObjectId(workspaceId);
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const past7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const past30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    allKeys,
    allWebhooks,
    webhookDeliveries,
    members,
    failedLogins,
    refreshReplays,
    keyRevocations,
    keyRotations,
    totalSecurityEvents,
  ] = await Promise.all([
    APIKeyModel.find({ workspaceId: wsObjectId }).lean(),
    WebhookModel.find({ workspaceId: wsObjectId }).lean(),
    WebhookDeliveryModel.aggregate([
      { $match: { workspaceId: wsObjectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WorkspaceMemberModel.find({ workspaceId: wsObjectId }).lean(),
    AuditLogModel.countDocuments({
      workspaceId: wsObjectId,
      action: 'AUTH_LOGIN_FAILED',
      createdAt: { $gte: past7Days },
    }),
    AuditLogModel.countDocuments({
      workspaceId: wsObjectId,
      action: 'AUTH_REFRESH_REPLAY',
      createdAt: { $gte: past7Days },
    }),
    AuditLogModel.countDocuments({
      workspaceId: wsObjectId,
      action: 'API_KEY_REVOKED',
      createdAt: { $gte: past30Days },
    }),
    AuditLogModel.countDocuments({
      workspaceId: wsObjectId,
      action: 'API_KEY_ROTATED',
      createdAt: { $gte: past30Days },
    }),
    AuditLogModel.countDocuments({
      workspaceId: wsObjectId,
      action: {
        $in: [
          'AUTH_LOGIN_FAILED',
          'AUTH_REFRESH_REPLAY',
          'API_KEY_REVOKED',
          'API_KEY_ROTATED',
          'API_KEY_RATE_LIMIT_UPDATED',
          'WORKSPACE_MEMBER_ROLE_CHANGED',
          'WORKSPACE_MEMBER_REMOVED',
          'WORKSPACE_UPDATED',
        ],
      },
      createdAt: { $gte: past7Days },
    }),
  ]);

  // Analyze API keys
  let activeKeys = 0;
  let revokedKeys = 0;
  let expiredKeys = 0;
  let expiringSoonKeys = 0;
  let withoutRateLimitKeys = 0;
  let adminPermissionKeys = 0;

  for (const key of allKeys) {
    if (key.status === 'ACTIVE') {
      activeKeys += 1;
      if (key.expiresAt && new Date(key.expiresAt) < now) {
        expiredKeys += 1;
      } else if (key.expiresAt && new Date(key.expiresAt) <= in30Days) {
        expiringSoonKeys += 1;
      }
      if (!key.rateLimit || (key.rateLimit.requestsPerMinute >= 1000 && key.rateLimit.executionsPerHour >= 5000)) {
        withoutRateLimitKeys += 1;
      }
      if (key.permissions.includes('MEMBER_MANAGE') || key.permissions.includes('AUDIT_READ')) {
        adminPermissionKeys += 1;
      }
    } else if (key.status === 'REVOKED') {
      revokedKeys += 1;
    }
  }

  // Analyze Webhooks
  let activeWebhooks = 0;
  let disabledWebhooks = 0;
  let failingWebhooks = 0;

  // Build map of webhookId -> failed delivery count
  const failedDeliveryCountMap = new Map<string, number>();
  for (const d of webhookDeliveries) {
    if (d._id === 'FAILED') {
      const webhookId = d.webhookId?.toString() ?? '';
      if (webhookId) {
        const current = failedDeliveryCountMap.get(webhookId) ?? 0;
        failedDeliveryCountMap.set(webhookId, current + d.count);
      }
    }
  }

  for (const wh of allWebhooks) {
    if (wh.status === 'ACTIVE') {
      activeWebhooks += 1;
      const failedCount = failedDeliveryCountMap.get(wh._id.toString()) ?? 0;
      if (failedCount > 0) {
        failingWebhooks += 1;
      }
    } else if (wh.status === 'DISABLED') {
      disabledWebhooks += 1;
    }
  }

  let totalDeliveries = 0;
  let failedDeliveries = 0;
  for (const d of webhookDeliveries) {
    totalDeliveries += d.count;
    if (d._id === 'FAILED') failedDeliveries = d.count;
  }
  const webhookFailureRate = totalDeliveries > 0 ? Math.round((failedDeliveries / totalDeliveries) * 10000) / 10000 : 0;

  // Analyze Members
  let totalMembers = 0;
  let owners = 0;
  let admins = 0;
  let editors = 0;
  let viewers = 0;
  let pendingInvitations = 0;

  for (const m of members) {
    totalMembers += 1;
    if (m.status === 'ACTIVE') {
      if (m.role === 'OWNER') owners += 1;
      else if (m.role === 'ADMIN') admins += 1;
      else if (m.role === 'EDITOR') editors += 1;
      else if (m.role === 'VIEWER') viewers += 1;
    } else if (m.status === 'INVITED') {
      pendingInvitations += 1;
    }
  }

  // Recommendations and Score
  const recommendations: SecurityOverviewView['recommendations'] = [];
  let score = 100;

  if (failedLogins > 5) {
    score -= 15;
    recommendations.push({
      id: 'rec-failed-logins',
      severity: 'HIGH',
      title: 'High Volume of Failed Logins',
      description: `${failedLogins} failed login attempts detected in the past 7 days. Review user access logs.`,
    });
  }

  if (refreshReplays > 0) {
    score -= 25;
    recommendations.push({
      id: 'rec-refresh-replay',
      severity: 'CRITICAL',
      title: 'Token Replay Attempts Detected',
      description: `${refreshReplays} refresh token replay incidents detected. Affected sessions were terminated.`,
    });
  }

  if (failingWebhooks > 0) {
    score -= 10;
    recommendations.push({
      id: 'rec-failing-webhooks',
      severity: 'MEDIUM',
      title: 'Failing Webhook Endpoints',
      description: `${failingWebhooks} active webhook(s) are experiencing delivery failures. Review webhook URLs and receivers.`,
    });
  }

  if (expiredKeys > 0) {
    score -= 10;
    recommendations.push({
      id: 'rec-expired-keys',
      severity: 'MEDIUM',
      title: 'Expired API Keys Still Active',
      description: `${expiredKeys} API key(s) have passed their expiration date. Revoke or rotate these keys.`,
    });
  }

  if (expiringSoonKeys > 0) {
    recommendations.push({
      id: 'rec-expiring-keys',
      severity: 'LOW',
      title: 'API Keys Expiring Soon',
      description: `${expiringSoonKeys} API key(s) will expire in the next 30 days. Plan rotation accordingly.`,
    });
  }

  if (withoutRateLimitKeys > 0) {
    recommendations.push({
      id: 'rec-unlimited-keys',
      severity: 'LOW',
      title: 'API Keys Without Custom Rate Limits',
      description: `${withoutRateLimitKeys} API key(s) use default rate limits. Consider setting explicit limits.`,
    });
  }

  score = Math.max(0, Math.min(100, score));
  let status: 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL' = 'EXCELLENT';
  if (score < 50) status = 'CRITICAL';
  else if (score < 75) status = 'WARNING';
  else if (score < 90) status = 'GOOD';

  return {
    workspaceId,
    score,
    status,
    apiKeys: {
      total: allKeys.length,
      active: activeKeys,
      revoked: revokedKeys,
      expired: expiredKeys,
      expiringSoon: expiringSoonKeys,
      withoutRateLimit: withoutRateLimitKeys,
      adminPermissions: adminPermissionKeys,
    },
    webhooks: {
      total: allWebhooks.length,
      active: activeWebhooks,
      disabled: disabledWebhooks,
      failing: failingWebhooks,
      totalDeliveries,
      failedDeliveries,
      failureRate: webhookFailureRate,
    },
    access: {
      totalMembers,
      owners,
      admins,
      editors,
      viewers,
      pendingInvitations,
    },
    events: {
      failedLoginsLast7d: failedLogins,
      refreshReplaysLast7d: refreshReplays,
      apiKeyRevocationsLast30d: keyRevocations,
      apiKeyRotationsLast30d: keyRotations,
      totalSecurityEventsLast7d: totalSecurityEvents,
    },
    recommendations,
  };
}

export async function getSecurityEvents(
  workspaceId: string,
  options?: { limit?: number; offset?: number },
): Promise<AuditQueryResult> {
  const securityActions = [
    'AUTH_LOGIN_FAILED',
    'AUTH_REFRESH_REPLAY',
    'API_KEY_REVOKED',
    'API_KEY_ROTATED',
    'API_KEY_RATE_LIMIT_UPDATED',
    'WORKSPACE_MEMBER_ROLE_CHANGED',
    'WORKSPACE_MEMBER_REMOVED',
    'WORKSPACE_UPDATED',
  ] as const;

  return queryAuditLogs(
    workspaceId,
    { action: [...securityActions] },
    options,
  );
}

// -------------------------------------------------------------
// 4. System Administration
// -------------------------------------------------------------

export async function getSystemHealth(healthChecks: HealthChecks): Promise<SystemHealthView> {
  const safely = async (check: () => Promise<HealthCheckResult>): Promise<HealthCheckResult> => {
    try {
      return await check();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'check failed';
      return { status: 'down', latencyMs: 0, detail: msg };
    }
  };

  const [mongo, redis, worker] = await Promise.all([
    safely(healthChecks.mongo),
    safely(healthChecks.redis),
    safely(healthChecks.worker),
  ]);

  const operational = mongo.status === 'up' && redis.status !== 'down';
  const degraded = worker.status === 'down';
  const status = operational ? (degraded ? 'degraded' : 'ok') : 'unavailable';

  const mem = process.memoryUsage();

  return {
    status,
    checks: { mongo, redis, worker },
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      heapUsedMB: Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / (1024 * 1024)) * 100) / 100,
      rssMB: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getSystemMetrics(): Promise<SystemMetricsView> {
  const [
    userCount,
    workspaceAggs,
    workflowAggs,
    executionAggs,
    deadLetterCount,
    apiKeyAggs,
    webhookAggs,
    auditLogCount,
  ] = await Promise.all([
    UserModel.countDocuments({}),
    WorkspaceModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    WorkflowModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    WorkflowExecutionModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    DeadLetterModel.countDocuments({}),
    APIKeyModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    WebhookModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    AuditLogModel.countDocuments({}),
  ]);

  // Workspaces
  let totalWorkspaces = 0;
  let activeWorkspaces = 0;
  let suspendedWorkspaces = 0;
  let deletedWorkspaces = 0;
  for (const item of workspaceAggs) {
    totalWorkspaces += item.count;
    if (item._id === 'ACTIVE') activeWorkspaces = item.count;
    else if (item._id === 'SUSPENDED') suspendedWorkspaces = item.count;
    else if (item._id === 'DELETED') deletedWorkspaces = item.count;
  }

  // Workflows
  let totalWorkflows = 0;
  let activeWorkflows = 0;
  let draftWorkflows = 0;
  let archivedWorkflows = 0;
  for (const item of workflowAggs) {
    totalWorkflows += item.count;
    if (item._id === 'ACTIVE') activeWorkflows = item.count;
    else if (item._id === 'DRAFT') draftWorkflows = item.count;
    else if (item._id === 'ARCHIVED') archivedWorkflows = item.count;
  }

  // Executions
  let totalExecutions = 0;
  let succeededExecutions = 0;
  let failedExecutions = 0;
  let runningExecutions = 0;
  let pendingExecutions = 0;
  for (const item of executionAggs) {
    totalExecutions += item.count;
    if (item._id === 'SUCCEEDED') succeededExecutions = item.count;
    else if (item._id === 'FAILED') failedExecutions = item.count;
    else if (item._id === 'RUNNING') runningExecutions = item.count;
    else if (item._id === 'PENDING') pendingExecutions = item.count;
  }

  // API Keys
  let totalApiKeys = 0;
  let activeApiKeys = 0;
  for (const item of apiKeyAggs) {
    totalApiKeys += item.count;
    if (item._id === 'ACTIVE') activeApiKeys = item.count;
  }

  // Webhooks
  let totalWebhooks = 0;
  let activeWebhooks = 0;
  for (const item of webhookAggs) {
    totalWebhooks += item.count;
    if (item._id === 'ACTIVE') activeWebhooks = item.count;
  }

  return {
    users: userCount,
    workspaces: {
      total: totalWorkspaces,
      active: activeWorkspaces,
      suspended: suspendedWorkspaces,
      deleted: deletedWorkspaces,
    },
    workflows: {
      total: totalWorkflows,
      active: activeWorkflows,
      draft: draftWorkflows,
      archived: archivedWorkflows,
    },
    executions: {
      total: totalExecutions,
      succeeded: succeededExecutions,
      failed: failedExecutions,
      running: runningExecutions,
      pending: pendingExecutions,
    },
    deadLetters: deadLetterCount,
    apiKeys: {
      total: totalApiKeys,
      active: activeApiKeys,
    },
    webhooks: {
      total: totalWebhooks,
      active: activeWebhooks,
    },
    auditLogs: auditLogCount,
    timestamp: new Date().toISOString(),
  };
}

export async function triggerRecalculateAnalytics(
  workspaceId?: string,
  actorUserId?: string,
): Promise<AnalyticsRecalculationSummary> {
  const result = await recalculateAnalytics(workspaceId);

  if (actorUserId) {
    await createAuditLog({
      action: 'WORKSPACE_UPDATED',
      userId: actorUserId,
      workspaceId,
      resource: 'analytics',
      metadata: { action: 'recalculate_analytics', summary: result },
    });
  }

  return result;
}

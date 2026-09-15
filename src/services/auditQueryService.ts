import { Types } from 'mongoose';
import { AuditLogModel, AUDIT_ACTIONS } from '../models/AuditLogModel.js';
import type { AuditAction, IAuditLog } from '../models/AuditLogModel.js';

export interface AuditFilter {
  userId?: string;
  action?: AuditAction | AuditAction[];
  resource?: string;
  resourceId?: string;
  startDate?: Date | string;
  endDate?: Date | string;
  ipAddress?: string;
  search?: string;
}

export interface AuditQueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'action' | 'resource';
  sortOrder?: 'asc' | 'desc';
}

export interface AuditLogView {
  id: string;
  userId: string | null;
  workspaceId: string | null;
  action: AuditAction;
  resource: string | undefined;
  resourceId: string | undefined;
  metadata: Record<string, unknown> | undefined;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  createdAt: string;
}

export interface AuditQueryResult {
  logs: AuditLogView[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AuditSummaryView {
  workspaceId: string;
  totalEvents: number;
  eventsByAction: Record<string, number>;
  eventsByResource: Record<string, number>;
  securityEventsCount: number;
  recentActivityCount: number;
}

const SECURITY_ACTIONS: readonly AuditAction[] = [
  'AUTH_LOGIN_FAILED',
  'AUTH_REFRESH_REPLAY',
  'API_KEY_REVOKED',
  'API_KEY_ROTATED',
  'API_KEY_RATE_LIMIT_UPDATED',
  'WORKSPACE_MEMBER_ROLE_CHANGED',
  'WORKSPACE_MEMBER_REMOVED',
  'WORKSPACE_UPDATED',
];

function toAuditLogView(log: IAuditLog): AuditLogView {
  return {
    id: log._id.toString(),
    userId: log.userId ? log.userId.toString() : null,
    workspaceId: log.workspaceId ? log.workspaceId.toString() : null,
    action: log.action,
    resource: log.resource,
    resourceId: log.resourceId,
    metadata: log.metadata,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : new Date(log.createdAt).toISOString(),
  };
}

export async function queryAuditLogs(
  workspaceId: string,
  filters: AuditFilter = {},
  options: AuditQueryOptions = {},
): Promise<AuditQueryResult> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }

  const match: Record<string, unknown> = {
    workspaceId: new Types.ObjectId(workspaceId),
  };

  if (filters.userId) {
    if (!Types.ObjectId.isValid(filters.userId)) {
      throw new Error('INVALID_USER_ID');
    }
    match.userId = new Types.ObjectId(filters.userId);
  }

  if (filters.action) {
    if (Array.isArray(filters.action)) {
      match.action = { $in: filters.action };
    } else {
      match.action = filters.action;
    }
  }

  if (filters.resource) {
    match.resource = filters.resource;
  }

  if (filters.resourceId) {
    match.resourceId = filters.resourceId;
  }

  if (filters.ipAddress) {
    match.ipAddress = filters.ipAddress;
  }

  if (filters.startDate || filters.endDate) {
    const dateQuery: Record<string, Date> = {};
    if (filters.startDate) {
      dateQuery.$gte = filters.startDate instanceof Date ? filters.startDate : new Date(filters.startDate);
    }
    if (filters.endDate) {
      dateQuery.$lte = filters.endDate instanceof Date ? filters.endDate : new Date(filters.endDate);
    }
    match.createdAt = dateQuery;
  }

  if (filters.search) {
    const searchRegex = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    match.$or = [
      { resource: searchRegex },
      { resourceId: searchRegex },
      { 'metadata.name': searchRegex },
    ];
  }

  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const sortBy = options.sortBy ?? 'createdAt';
  const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder };

  const [logs, total] = await Promise.all([
    AuditLogModel.find(match)
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .lean(),
    AuditLogModel.countDocuments(match),
  ]);

  return {
    logs: logs.map(toAuditLogView),
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

export async function getAuditLogById(
  id: string,
  workspaceId: string,
): Promise<AuditLogView | null> {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error('INVALID_AUDIT_LOG_ID');
  }
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }

  const log = await AuditLogModel.findOne({
    _id: new Types.ObjectId(id),
    workspaceId: new Types.ObjectId(workspaceId),
  }).lean();

  if (!log) return null;

  return toAuditLogView(log);
}

export function getAuditActions(): readonly AuditAction[] {
  return AUDIT_ACTIONS;
}

export async function getAuditSummary(
  workspaceId: string,
  days = 30,
): Promise<AuditSummaryView> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }

  const wsObjectId = new Types.ObjectId(workspaceId);
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalEvents, actionAggs, resourceAggs, securityCount, recentCount] = await Promise.all([
    AuditLogModel.countDocuments({ workspaceId: wsObjectId }),
    AuditLogModel.aggregate([
      { $match: { workspaceId: wsObjectId, createdAt: { $gte: cutoffDate } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]),
    AuditLogModel.aggregate([
      { $match: { workspaceId: wsObjectId, resource: { $exists: true, $ne: null } } },
      { $group: { _id: '$resource', count: { $sum: 1 } } },
    ]),
    AuditLogModel.countDocuments({
      workspaceId: wsObjectId,
      action: { $in: SECURITY_ACTIONS },
      createdAt: { $gte: cutoffDate },
    }),
    AuditLogModel.countDocuments({
      workspaceId: wsObjectId,
      createdAt: { $gte: recentCutoff },
    }),
  ]);

  const eventsByAction: Record<string, number> = {};
  for (const item of actionAggs) {
    if (item._id) eventsByAction[item._id] = item.count;
  }

  const eventsByResource: Record<string, number> = {};
  for (const item of resourceAggs) {
    if (item._id) eventsByResource[item._id] = item.count;
  }

  return {
    workspaceId,
    totalEvents,
    eventsByAction,
    eventsByResource,
    securityEventsCount: securityCount,
    recentActivityCount: recentCount,
  };
}

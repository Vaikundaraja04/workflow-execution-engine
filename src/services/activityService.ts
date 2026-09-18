import { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLogModel.js';
import type { AuditAction } from '../models/AuditLogModel.js';
import { UserModel } from '../models/UserModel.js';
import { checkUserPermission } from './permissionService.js';

export interface ActivityFilterOptions {
  userId?: string | undefined;
  resource?: string | undefined;
  action?: string | undefined;
  startDate?: string | Date | undefined;
  endDate?: string | Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ActivityItem {
  id: string;
  action: string;
  userId?: string | undefined;
  userEmail?: string | undefined;
  userName?: string | undefined;
  workspaceId?: string | undefined;
  resource?: string | undefined;
  resourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  timestamp: Date;
}

export class ActivityService {
  /**
   * Get workspace activity feed with aggregation and user info
   */
  async getWorkspaceActivity(
    workspaceId: string,
    currentUserId: string,
    options: ActivityFilterOptions = {},
  ): Promise<{ activities: ActivityItem[]; total: number }> {
    if (!Types.ObjectId.isValid(workspaceId) || !Types.ObjectId.isValid(currentUserId)) {
      return { activities: [], total: 0 };
    }

    const permissionCheck = await checkUserPermission(workspaceId, currentUserId, 'AUDIT_READ');
    if (permissionCheck.outcome !== 'allow') {
      throw new Error('PERMISSION_DENIED');
    }

    const query: any = {
      workspaceId: new Types.ObjectId(workspaceId),
    };

    if (options.userId && Types.ObjectId.isValid(options.userId)) {
      query.userId = new Types.ObjectId(options.userId);
    }

    if (options.resource) {
      query.resource = options.resource;
    }

    if (options.action) {
      query.action = options.action;
    }

    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = new Date(options.startDate);
      }
      if (options.endDate) {
        query.createdAt.$lte = new Date(options.endDate);
      }
    }

    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);

    const [logs, total] = await Promise.all([
      AuditLogModel.find(query)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .populate('userId', 'email')
        .lean(),
      AuditLogModel.countDocuments(query),
    ]);

    const activities: ActivityItem[] = logs.map((log: any) => {
      const userObj = log.userId as { _id?: Types.ObjectId; email?: string } | undefined;
      const email = userObj?.email;
      const name = email ? email.split('@')[0] : undefined;

      return {
        id: log._id.toString(),
        action: log.action,
        userId: userObj?._id?.toString() || (log.userId ? log.userId.toString() : undefined),
        userEmail: email,
        userName: name,
        workspaceId: log.workspaceId ? log.workspaceId.toString() : undefined,
        resource: log.resource,
        resourceId: log.resourceId,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        timestamp: log.createdAt,
      };
    });

    return { activities, total };
  }
}

export const activityService = new ActivityService();

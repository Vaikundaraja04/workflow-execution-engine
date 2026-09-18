import { Types } from 'mongoose';
import { NotificationModel } from '../models/NotificationModel.js';
import type { INotification, NotificationType } from '../models/NotificationModel.js';
import { emitToUser } from '../realtime/socketServer.js';
import { COLLABORATION_EVENTS } from '../realtime/collaborationEvents.js';
import { createAuditLog } from './auditService.js';

export interface CreateNotificationDto {
  userId: string;
  workspaceId: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationDto {
  id: string;
  userId: string;
  workspaceId: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationService {
  /**
   * Create a new notification and send it in real-time
   */
  async createNotification(dto: CreateNotificationDto): Promise<NotificationDto> {
    if (!Types.ObjectId.isValid(dto.userId) || !Types.ObjectId.isValid(dto.workspaceId)) {
      throw new Error('INVALID_ID');
    }

    const notification = await NotificationModel.create({
      userId: new Types.ObjectId(dto.userId),
      workspaceId: new Types.ObjectId(dto.workspaceId),
      type: dto.type,
      title: dto.title,
      message: dto.message,
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      metadata: dto.metadata ?? {},
      isRead: false,
    });

    const result = this.toDto(notification);

    // Emit real-time notification to the user
    emitToUser(dto.userId, COLLABORATION_EVENTS.NOTIFICATION_NEW, { notification: result });

    // Broadcast updated unread count to the user
    const unreadCount = await this.getUnreadCount(dto.userId, dto.workspaceId);
    emitToUser(dto.userId, COLLABORATION_EVENTS.NOTIFICATION_COUNT, { unreadCount, workspaceId: dto.workspaceId });

    return result;
  }

  /**
   * Get paginated notifications for a user in a workspace
   */
  async getUserNotifications(
    userId: string,
    workspaceId: string,
    options: { limit?: number | undefined; offset?: number | undefined; isRead?: boolean | undefined } = {},
  ): Promise<{ notifications: NotificationDto[]; total: number; unreadCount: number }> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(workspaceId)) {
      return { notifications: [], total: 0, unreadCount: 0 };
    }

    const query: any = {
      userId: new Types.ObjectId(userId),
      workspaceId: new Types.ObjectId(workspaceId),
    };

    if (options.isRead !== undefined) {
      query.isRead = options.isRead;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      NotificationModel.find(query)
        .sort({ createdAt: -1 })
        .skip(options.offset ?? 0)
        .limit(options.limit ?? 50)
        .lean(),
      NotificationModel.countDocuments(query),
      NotificationModel.countDocuments({
        userId: new Types.ObjectId(userId),
        workspaceId: new Types.ObjectId(workspaceId),
        isRead: false,
      }),
    ]);

    return {
      notifications: notifications.map((n) => this.toDto(n)),
      total,
      unreadCount,
    };
  }

  /**
   * Get unread count for user in workspace
   */
  async getUnreadCount(userId: string, workspaceId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(workspaceId)) {
      return 0;
    }

    return NotificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      workspaceId: new Types.ObjectId(workspaceId),
      isRead: false,
    });
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<NotificationDto | null> {
    if (!Types.ObjectId.isValid(notificationId) || !Types.ObjectId.isValid(userId)) {
      return null;
    }

    const notification = await NotificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      { new: true },
    );

    if (!notification) return null;

    const dto = this.toDto(notification);

    const unreadCount = await this.getUnreadCount(userId, notification.workspaceId.toString());
    emitToUser(userId, COLLABORATION_EVENTS.NOTIFICATION_COUNT, {
      unreadCount,
      workspaceId: notification.workspaceId.toString(),
    });

    return dto;
  }

  /**
   * Mark all notifications as read for a user in a workspace
   */
  async markAllAsRead(userId: string, workspaceId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(workspaceId)) {
      return 0;
    }

    const result = await NotificationModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        workspaceId: new Types.ObjectId(workspaceId),
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    emitToUser(userId, COLLABORATION_EVENTS.NOTIFICATION_COUNT, { unreadCount: 0, workspaceId });

    return result.modifiedCount;
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(notificationId) || !Types.ObjectId.isValid(userId)) {
      return false;
    }

    const result = await NotificationModel.deleteOne({
      _id: new Types.ObjectId(notificationId),
      userId: new Types.ObjectId(userId),
    });

    return result.deletedCount > 0;
  }

  private toDto(doc: any): NotificationDto {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      workspaceId: doc.workspaceId.toString(),
      type: doc.type,
      title: doc.title,
      message: doc.message,
      resourceType: doc.resourceType,
      resourceId: doc.resourceId,
      metadata: doc.metadata,
      isRead: doc.isRead,
      readAt: doc.readAt ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}

export const notificationService = new NotificationService();

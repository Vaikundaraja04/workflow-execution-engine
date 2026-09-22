import { apiClient } from './apiClient';
import type {
  PresenceState,
  WorkflowComment,
  CreateCommentDTO,
  UpdateCommentDTO,
  Notification,
  ActivityFilter,
  ActivityItem,
  WorkflowLockState
} from '@/types/collaboration';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

export const collaborationApi = {
  // Comments endpoints
  getWorkflowComments: async (
    workflowId: string,
    params?: {
      limit?: number;
      offset?: number;
      parentId?: string | null;
      includeResolved?: boolean;
    },
    workspaceId?: string
  ): Promise<{ comments: WorkflowComment[]; total: number }> => {
    const res = await apiClient.get<{ comments: WorkflowComment[]; total: number }>(
      `/api/v1/comments/workflow/${workflowId}`,
      {
        params,
        ...workspaceConfig(workspaceId),
      }
    );
    return res.data;
  },

  createComment: async (
    workflowId: string,
    data: CreateCommentDTO,
    workspaceId?: string
  ): Promise<WorkflowComment> => {
    const res = await apiClient.post<WorkflowComment>(
      `/api/v1/comments/workflow/${workflowId}`,
      data,
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  updateComment: async (
    commentId: string,
    data: UpdateCommentDTO,
    workspaceId?: string
  ): Promise<WorkflowComment> => {
    const res = await apiClient.put<WorkflowComment>(
      `/api/v1/comments/${commentId}`,
      data,
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  deleteComment: async (
    commentId: string,
    workspaceId?: string
  ): Promise<void> => {
    await apiClient.delete<void>(
      `/api/v1/comments/${commentId}`,
      workspaceConfig(workspaceId)
    );
  },

  resolveComment: async (
    commentId: string,
    workspaceId?: string
  ): Promise<WorkflowComment> => {
    const res = await apiClient.put<WorkflowComment>(
      `/api/v1/comments/${commentId}`,
      { status: 'RESOLVED' },
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  reopenComment: async (
    commentId: string,
    workspaceId?: string
  ): Promise<WorkflowComment> => {
    const res = await apiClient.put<WorkflowComment>(
      `/api/v1/comments/${commentId}`,
      { status: 'OPEN' },
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  // Workflow Locks endpoints
  acquireLock: async (
    workflowId: string,
    ttlSeconds: number = 30,
    workspaceId?: string
  ): Promise<{ acquired: boolean; lock?: WorkflowLockState; conflict?: WorkflowLockState }> => {
    const res = await apiClient.post<{ acquired: boolean; lock?: WorkflowLockState; conflict?: WorkflowLockState }>(
      `/api/v1/locks/workflows/${workflowId}/acquire`,
      { ttlSeconds },
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  heartbeatLock: async (
    workflowId: string,
    lockToken: string,
    ttlSeconds: number = 30,
    workspaceId?: string
  ): Promise<{ acquired: boolean; lock?: WorkflowLockState }> => {
    const res = await apiClient.put<{ acquired: boolean; lock?: WorkflowLockState }>(
      `/api/v1/locks/workflows/${workflowId}/heartbeat`,
      { lockToken, ttlSeconds },
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  releaseLock: async (
    workflowId: string,
    payload: { lockToken?: string; force?: boolean },
    workspaceId?: string
  ): Promise<void> => {
    await apiClient.delete<void>(
      `/api/v1/locks/workflows/${workflowId}/release`,
      {
        data: payload,
        ...workspaceConfig(workspaceId),
      }
    );
  },

  getWorkflowLock: async (
    workflowId: string,
    workspaceId?: string
  ): Promise<WorkflowLockState | null> => {
    try {
      const res = await apiClient.get<WorkflowLockState>(
        `/api/v1/locks/workflows/${workflowId}`,
        workspaceConfig(workspaceId)
      );
      return res.data;
    } catch {
      return null;
    }
  },

  // Notification endpoints
  getNotifications: async (
    params?: {
      limit?: number;
      offset?: number;
      isRead?: boolean;
    },
    workspaceId?: string
  ): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> => {
    const res = await apiClient.get<{ notifications: Notification[]; total: number; unreadCount: number }>(
      '/api/v1/notifications',
      {
        params,
        ...workspaceConfig(workspaceId),
      }
    );
    return res.data;
  },

  getUnreadCount: async (workspaceId?: string): Promise<{ count: number }> => {
    const res = await apiClient.get<{ count: number }>(
      '/api/v1/notifications/unread-count',
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  markAsRead: async (
    notificationId: string,
    workspaceId?: string
  ): Promise<Notification> => {
    const res = await apiClient.post<Notification>(
      `/api/v1/notifications/${notificationId}/read`,
      {},
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  markAllAsRead: async (workspaceId?: string): Promise<{ count: number }> => {
    const res = await apiClient.post<{ count: number }>(
      '/api/v1/notifications/read-all',
      {},
      workspaceConfig(workspaceId)
    );
    return res.data;
  },

  deleteNotification: async (
    notificationId: string,
    workspaceId?: string
  ): Promise<void> => {
    await apiClient.delete<void>(
      `/api/v1/notifications/${notificationId}`,
      workspaceConfig(workspaceId)
    );
  },

  // Activity Feed endpoints
  getActivityFeed: async (
    filters?: ActivityFilter,
    workspaceId?: string
  ): Promise<{ activities: ActivityItem[]; total: number }> => {
    const res = await apiClient.get<{ activities: ActivityItem[]; total: number }>(
      '/api/v1/activity',
      {
        params: filters,
        ...workspaceConfig(workspaceId),
      }
    );
    return res.data;
  },
};

export default collaborationApi;

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import collaborationApi from '@/services/collaborationApi';
import type {
  PresenceState,
  WorkflowComment,
  Notification,
  ActivityItem,
  WorkflowLockState
} from '@/types/collaboration';

interface CollaborationState {
  // Presence
  workspacePresences: Record<string, PresenceState[]>; // workspaceId -> presences
  workflowPresences: Record<string, PresenceState[]>; // workflowId -> presences
  userCursorPositions: Record<string, { x: number; y: number; nodeId?: string }>; // userId -> cursor
  userSelections: Record<string, string[]>; // userId -> selected nodeIds

  // Comments
  workflowComments: Record<string, WorkflowComment[]>; // workflowId -> comments
  commentLoading: Record<string, boolean>; // workflowId -> loading state

  // Notifications
  notifications: Notification[];
  unreadCount: number;
  notificationsLoading: boolean;

  // Activity Feed
  activityFeed: ActivityItem[];
  activityLoading: boolean;
  activityTotal: number;

  // Workflow Locks
  workflowLocks: Record<string, WorkflowLockState | null>; // workflowId -> lock state or null
  lockLoading: Record<string, boolean>; // workflowId -> loading state

  // Actions
  initializePresence: (workspaceId: string) => Promise<void>;
  joinWorkspace: (workspaceId: string) => Promise<void>;
  leaveWorkspace: (workspaceId: string) => Promise<void>;
  joinWorkflow: (workflowId: string) => Promise<void>;
  leaveWorkflow: (workflowId: string) => Promise<void>;
  updateCursor: (data: { workflowId: string; x: number; y: number; nodeId?: string }) => Promise<void>;
  updateSelection: (data: { workflowId: string; nodeIds: string[] }) => Promise<void>;
  fetchWorkspacePresences: (workspaceId: string) => Promise<void>;
  fetchWorkflowPresences: (workflowId: string) => Promise<void>;

  // Comment actions
  fetchWorkflowComments: (workflowId: string, params?: { limit?: number; offset?: number; parentId?: string | null; includeResolved?: boolean }) => Promise<void>;
  createComment: (workflowId: string, commentData: any) => Promise<void>;
  updateComment: (commentId: string, commentData: any) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  resolveComment: (commentId: string) => Promise<void>;
  reopenComment: (commentId: string) => Promise<void>;

  // Notification actions
  fetchNotifications: (params?: { limit?: number; offset?: number; isRead?: boolean }) => Promise<void>;
  getUnreadCount: () => Promise<void>;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;

  // Activity feed actions
  fetchActivityFeed: (filters?: any) => Promise<void>;

  // Workflow lock actions
  acquireWorkflowLock: (workflowId: string, ttlSeconds?: number) => Promise<{ acquired: boolean; lock?: WorkflowLockState; conflict?: WorkflowLockState }>;
  heartbeatWorkflowLock: (workflowId: string, lockToken: string, ttlSeconds?: number) => Promise<{ acquired: boolean; lock?: WorkflowLockState }>;
  releaseWorkflowLock: (workflowId: string, payload: { lockToken?: string; force?: boolean }) => Promise<void>;
  fetchWorkflowLock: (workflowId: string) => Promise<WorkflowLockState | null>;
}

export const useCollaborationStore = create<CollaborationState>()(
  devtools(
    (set, get) => ({
      // Initial state
      workspacePresences: {},
      workflowPresences: {},
      userCursorPositions: {},
      userSelections: {},
      workflowComments: {},
      commentLoading: {},
      notifications: [],
      unreadCount: 0,
      notificationsLoading: false,
      activityFeed: [],
      activityLoading: false,
      activityTotal: 0,
      workflowLocks: {},
      lockLoading: {},

      // Presence actions
      initializePresence: async (workspaceId: string) => {
        try {
          // We would typically join the workspace via socket.io, not REST
          // For now, we'll just fetch presences
          await get().fetchWorkspacePresences(workspaceId);
        } catch (error) {
          console.error('Failed to initialize presence:', error);
        }
      },

      joinWorkspace: async (workspaceId: string) => {
        try {
          // This would be handled by socket.io connection
          // For REST API compatibility, we'll just fetch presences
          await get().fetchWorkspacePresences(workspaceId);
        } catch (error) {
          console.error('Failed to join workspace:', error);
        }
      },

      leaveWorkspace: async (workspaceId: string) => {
        try {
          // This would be handled by socket.io disconnection
          // Clear local state
          set((state) => ({
            workspacePresences: {
              ...state.workspacePresences,
              [workspaceId]: [],
            },
          }));
        } catch (error) {
          console.error('Failed to leave workspace:', error);
        }
      },

      joinWorkflow: async (workflowId: string) => {
        try {
          // This would be handled by socket.io
          await get().fetchWorkflowPresences(workflowId);
        } catch (error) {
          console.error('Failed to join workflow:', error);
        }
      },

      leaveWorkflow: async (workflowId: string) => {
        try {
          // This would be handled by socket.io
          set((state) => ({
            workflowPresences: {
              ...state.workflowPresences,
              [workflowId]: [],
            },
          }));
        } catch (error) {
          console.error('Failed to leave workflow:', error);
        }
      },

      updateCursor: async (data: { workflowId: string; x: number; y: number; nodeId?: string }) => {
        try {
          // This would be handled by socket.io
          // Update local cursor position for immediate UI feedback
          set((state) => ({
            userCursorPositions: {
              ...state.userCursorPositions,
              [data.workflowId]: { x: data.x, y: data.y, nodeId: data.nodeId },
            },
          }));
        } catch (error) {
          console.error('Failed to update cursor:', error);
        }
      },

      updateSelection: async (data: { workflowId: string; nodeIds: string[] }) => {
        try {
          // This would be handled by socket.io
          // Update local selection for immediate UI feedback
          set((state) => ({
            userSelections: {
              ...state.userSelections,
              [data.workflowId]: data.nodeIds,
            },
          }));
        } catch (error) {
          console.error('Failed to update selection:', error);
        }
      },

      fetchWorkspacePresences: async (workspaceId: string) => {
        try {
          // Note: This endpoint doesn't exist in our current API
          // We would typically get this via socket.io events
          // For now, we'll leave it as a placeholder
          console.log('fetchWorkspacePresences called - would be implemented via socket.io');
        } catch (error) {
          console.error('Failed to fetch workspace presences:', error);
        }
      },

      fetchWorkflowPresences: async (workflowId: string) => {
        try {
          // Note: This endpoint doesn't exist in our current API
          // We would typically get this via socket.io events
          console.log('fetchWorkflowPresences called - would be implemented via socket.io');
        } catch (error) {
          console.error('Failed to fetch workflow presences:', error);
        }
      },

      // Comment actions
      fetchWorkflowComments: async (workflowId: string, params) => {
        try {
          set((state) => ({
            commentLoading: {
              ...state.commentLoading,
              [workflowId]: true,
            },
          }));
          const res = await collaborationApi.getWorkflowComments(workflowId, params);
          set((state) => ({
            workflowComments: {
              ...state.workflowComments,
              [workflowId]: res.comments,
            },
            commentLoading: {
              ...state.commentLoading,
              [workflowId]: false,
            },
          }));
        } catch (error) {
          console.error('Failed to fetch workflow comments:', error);
          set((state) => ({
            commentLoading: {
              ...state.commentLoading,
              [workflowId]: false,
            },
          }));
        }
      },

      createComment: async (workflowId: string, commentData) => {
        try {
          const newComment = await collaborationApi.createComment(workflowId, commentData);
          set((state) => ({
            workflowComments: {
              ...state.workflowComments,
              [workflowId]: [newComment, ...(state.workflowComments[workflowId] || [])],
            },
          }));
          // Optionally, refetch comments to ensure consistency
          await get().fetchWorkflowComments(workflowId);
        } catch (error) {
          console.error('Failed to create comment:', error);
        }
      },

      updateComment: async (commentId: string, commentData) => {
        try {
          const updatedComment = await collaborationApi.updateComment(commentId, commentData);
          set((state) => {
            // Find the workflowId for the comment (we don't have it in the store, so we update all workflows)
            // In a real app, we might store workflowId with comment or have a separate map.
            // For simplicity, we'll update the comment in every workflow's comments list.
            const updatedWorkflowComments: Record<string, WorkflowComment[]> = {};
            for (const [wid, comments] of Object.entries(state.workflowComments)) {
              updatedWorkflowComments[wid] = comments.map((comment) =>
                comment.id === commentId ? updatedComment : comment
              );
            }
            return {
              workflowComments: updatedWorkflowComments,
            };
          });
        } catch (error) {
          console.error('Failed to update comment:', error);
        }
      },

      deleteComment: async (commentId: string) => {
        try {
          await collaborationApi.deleteComment(commentId);
          set((state) => {
            const updatedWorkflowComments: Record<string, WorkflowComment[]> = {};
            for (const [wid, comments] of Object.entries(state.workflowComments)) {
              updatedWorkflowComments[wid] = comments.filter(
                (comment) => comment.id !== commentId
              );
            }
            return {
              workflowComments: updatedWorkflowComments,
            };
          });
        } catch (error) {
          console.error('Failed to delete comment:', error);
        }
      },

      resolveComment: async (commentId: string) => {
        try {
          const resolvedComment = await collaborationApi.resolveComment(commentId);
          set((state) => {
            const updatedWorkflowComments: Record<string, WorkflowComment[]> = {};
            for (const [wid, comments] of Object.entries(state.workflowComments)) {
              updatedWorkflowComments[wid] = comments.map((comment) =>
                comment.id === commentId ? resolvedComment : comment
              );
            }
            return {
              workflowComments: updatedWorkflowComments,
            };
          });
        } catch (error) {
          console.error('Failed to resolve comment:', error);
        }
      },

      reopenComment: async (commentId: string) => {
        try {
          const reopenedComment = await collaborationApi.reopenComment(commentId);
          set((state) => {
            const updatedWorkflowComments: Record<string, WorkflowComment[]> = {};
            for (const [wid, comments] of Object.entries(state.workflowComments)) {
              updatedWorkflowComments[wid] = comments.map((comment) =>
                comment.id === commentId ? reopenedComment : comment
              );
            }
            return {
              workflowComments: updatedWorkflowComments,
            };
          });
        } catch (error) {
          console.error('Failed to reopen comment:', error);
        }
      },

      // Notification actions
      fetchNotifications: async (params) => {
        try {
          set({ notificationsLoading: true });
          const res = await collaborationApi.getNotifications(params);
          set({
            notifications: res.notifications,
            unreadCount: res.unreadCount,
            notificationsLoading: false,
          });
          // Set up socket.io listener for real-time notifications
          // This would be implemented in a useEffect in components
        } catch (error) {
          console.error('Failed to fetch notifications:', error);
          set({ notificationsLoading: false });
        }
      },

      getUnreadCount: async () => {
        try {
          const res = await collaborationApi.getUnreadCount();
          set({ unreadCount: res.count });
        } catch (error) {
          console.error('Failed to get unread count:', error);
        }
      },

      markNotificationAsRead: async (notificationId: string) => {
        try {
          const updatedNotification = await collaborationApi.markAsRead(notificationId);
          set((state) => ({
            notifications: state.notifications.map((n) =>
              n.id === notificationId ? updatedNotification : n
            ),
            unreadCount: Math.max(0, state.unreadCount - 1),
          }));
        } catch (error) {
          console.error('Failed to mark notification as read:', error);
        }
      },

      markAllNotificationsAsRead: async () => {
        try {
          const res = await collaborationApi.markAllAsRead();
          set({
            notifications: get().notifications.map((n) => ({ ...n, isRead: true })),
            unreadCount: 0,
          });
        } catch (error) {
          console.error('Failed to mark all notifications as read:', error);
        }
      },

      deleteNotification: async (notificationId: string) => {
        try {
          await collaborationApi.deleteNotification(notificationId);
          set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== notificationId),
            unreadCount: Math.max(0, state.unreadCount - 1),
          }));
        } catch (error) {
          console.error('Failed to delete notification:', error);
        }
      },

      // Activity feed actions
      fetchActivityFeed: async (filters) => {
        try {
          set({ activityLoading: true });
          const res = await collaborationApi.getActivityFeed(filters);
          set({
            activityFeed: res.activities,
            activityLoading: false,
            activityTotal: res.total,
          });
        } catch (error) {
          console.error('Failed to fetch activity feed:', error);
          set({ activityLoading: false });
        }
      },

      // Workflow lock actions
      acquireWorkflowLock: async (workflowId: string, ttlSeconds = 30) => {
        try {
          set((state) => ({
            lockLoading: {
              ...state.lockLoading,
              [workflowId]: true,
            },
          }));
          const res = await collaborationApi.acquireLock(workflowId, ttlSeconds);
          set((state) => ({
            workflowLocks: {
              ...state.workflowLocks,
              [workflowId]: res.lock ?? null,
            },
            lockLoading: {
              ...state.lockLoading,
              [workflowId]: false,
            },
          }));
          return res;
        } catch (error) {
          console.error('Failed to acquire workflow lock:', error);
          set((state) => ({
            lockLoading: {
              ...state.lockLoading,
              [workflowId]: false,
            },
          }));
          return { acquired: false };
        }
      },

      heartbeatWorkflowLock: async (workflowId: string, lockToken: string, ttlSeconds = 30) => {
        try {
          const res = await collaborationApi.heartbeatLock(workflowId, lockToken, ttlSeconds);
          set((state) => ({
            workflowLocks: {
              ...state.workflowLocks,
              [workflowId]: res.lock ?? null,
            },
          }));
          return res;
        } catch (error) {
          console.error('Failed to heartbeat workflow lock:', error);
          return { acquired: false };
        }
      },

      releaseWorkflowLock: async (workflowId: string, payload) => {
        try {
          await collaborationApi.releaseLock(workflowId, payload);
          set((state) => ({
            workflowLocks: {
              ...state.workflowLocks,
              [workflowId]: null,
            },
          }));
        } catch (error) {
          console.error('Failed to release workflow lock:', error);
        }
      },

      fetchWorkflowLock: async (workflowId: string) => {
        try {
          set((state) => ({
            lockLoading: {
              ...state.lockLoading,
              [workflowId]: true,
            },
          }));
          const lock = await collaborationApi.getWorkflowLock(workflowId);
          set((state) => ({
            workflowLocks: {
              ...state.workflowLocks,
              [workflowId]: lock,
            },
            lockLoading: {
              ...state.lockLoading,
              [workflowId]: false,
            },
          }));
          return lock;
        } catch (error) {
          console.error('Failed to fetch workflow lock:', error);
          set((state) => ({
            lockLoading: {
              ...state.lockLoading,
              [workflowId]: false,
            },
          }));
          return null;
        }
      },
    })
  )
);
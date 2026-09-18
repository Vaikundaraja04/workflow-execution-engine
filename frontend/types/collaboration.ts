export type PresenceStatus = 'ONLINE' | 'IDLE' | 'OFFLINE';

export interface UserPresence {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  color: string;
  workspaceId?: string;
  workflowId?: string;
  nodeId?: string;
  cursor?: { x: number; y: number };
  lastActive: string;
  status?: PresenceStatus;
}

export interface PresenceState {
  userId: string;
  email: string;
  name: string;
  color: string;
  workspaceId?: string;
  workflowId?: string;
  nodeId?: string;
  cursor?: { x: number; y: number };
  lastActive: string;
}

export type CommentStatus = 'OPEN' | 'RESOLVED';

export interface WorkflowComment {
  id: string;
  workflowId: string;
  workspaceId: string;
  nodeId?: string;
  userId: string;
  userEmail: string;
  userName: string;
  content: string;
  mentions: string[];
  parentCommentId?: string;
  status: CommentStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  replyCount?: number;
  replies?: WorkflowComment[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentDTO {
  content: string;
  nodeId?: string;
  parentCommentId?: string;
  mentions?: string[];
}

export interface UpdateCommentDTO {
  content?: string;
  status?: CommentStatus;
}

export type NotificationType =
  | 'COMMENT_MENTION'
  | 'COMMENT_REPLY'
  | 'WORKFLOW_LOCK_CONFLICT'
  | 'WORKFLOW_SHARED'
  | 'EXECUTION_COMPLETED'
  | 'EXECUTION_FAILED'
  | 'WORKSPACE_INVITE'
  | 'SYSTEM';

export interface Notification {
  id: string;
  userId: string;
  workspaceId?: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityFilter {
  startDate?: string;
  endDate?: string;
  userId?: string;
  action?: string;
  resource?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityItem {
  id: string;
  workspaceId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface WorkflowLockState {
  workflowId: string;
  userId: string;
  userName: string;
  userEmail: string;
  lockToken: string;
  acquiredAt: string;
  expiresAt: string;
  ttlRemainingMs: number;
  isOwner: boolean;
}

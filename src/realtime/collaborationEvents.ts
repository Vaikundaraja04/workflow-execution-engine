export const COLLABORATION_EVENTS = {
  // Presence
  PRESENCE_JOIN_WORKSPACE: 'presence:join-workspace',
  PRESENCE_LEAVE_WORKSPACE: 'presence:leave-workspace',
  PRESENCE_JOIN_WORKFLOW: 'presence:join-workflow',
  PRESENCE_LEAVE_WORKFLOW: 'presence:leave-workflow',
  PRESENCE_STATE: 'presence:state',
  PRESENCE_USER_JOINED: 'presence:user-joined',
  PRESENCE_USER_LEFT: 'presence:user-left',
  PRESENCE_CURSOR_MOVE: 'presence:cursor-move',
  PRESENCE_CURSOR_UPDATED: 'presence:cursor-updated',
  PRESENCE_SELECTION_CHANGE: 'presence:selection-change',
  PRESENCE_SELECTION_UPDATED: 'presence:selection-updated',

  // Comments
  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',
  COMMENT_RESOLVED: 'comment:resolved',
  COMMENT_TYPING: 'comment:typing',

  // Workflow Locks
  LOCK_ACQUIRED: 'lock:acquired',
  LOCK_RELEASED: 'lock:released',
  LOCK_HEARTBEAT: 'lock:heartbeat',
  LOCK_CONFLICT: 'lock:conflict',
  WORKFLOW_LOCK_ACQUIRED: 'workflow:lock_acquired',
  WORKFLOW_LOCK_RELEASED: 'workflow:lock_released',

  // Notifications
  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_READ: 'notification:read',
  NOTIFICATION_COUNT: 'notification:count',
  NOTIFICATION_RECEIVED: 'notification:received',

  // Workflow Realtime Changes
  WORKFLOW_EXTERNAL_UPDATE: 'workflow:external-update',
} as const;

export type CollaborationEvent = typeof COLLABORATION_EVENTS[keyof typeof COLLABORATION_EVENTS];

export interface UserPresence {
  userId: string;
  email: string;
  name?: string | undefined;
  avatarUrl?: string | undefined;
  color?: string | undefined;
  workspaceId: string;
  workflowId?: string | undefined;
  nodeId?: string | undefined;
  cursor?: { x: number; y: number } | undefined;
  lastActive: string;
}

export interface CursorPositionPayload {
  workflowId: string;
  nodeId?: string | undefined;
  x: number;
  y: number;
}

export interface NodeSelectionPayload {
  workflowId: string;
  nodeIds: string[];
}

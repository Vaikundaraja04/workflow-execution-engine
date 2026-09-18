import type { UserPresence, CursorPositionPayload, NodeSelectionPayload } from './collaborationEvents.js';

const USER_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#6366F1', // Indigo
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % USER_COLORS.length;
  return USER_COLORS[index]!;
}

export class PresenceManager {
  // Map of socketId -> UserPresence
  private socketPresence = new Map<string, UserPresence>();
  // Map of workspaceId -> Set of socketIds
  private workspaceSockets = new Map<string, Set<string>>();
  // Map of workflowId -> Set of socketIds
  private workflowSockets = new Map<string, Set<string>>();

  public addSocketPresence(
    socketId: string,
    user: { userId: string; email: string; name?: string | undefined },
    workspaceId: string,
  ): UserPresence {
    const presence: UserPresence = {
      userId: user.userId,
      email: user.email,
      name: user.name ?? user.email.split('@')[0],
      color: getColorForUser(user.userId),
      workspaceId,
      lastActive: new Date().toISOString(),
    };

    this.socketPresence.set(socketId, presence);

    if (!this.workspaceSockets.has(workspaceId)) {
      this.workspaceSockets.set(workspaceId, new Set());
    }
    this.workspaceSockets.get(workspaceId)!.add(socketId);

    return presence;
  }

  public joinWorkflow(socketId: string, workflowId: string): UserPresence | null {
    const presence = this.socketPresence.get(socketId);
    if (!presence) return null;

    // Remove from previous workflow if any
    if (presence.workflowId) {
      this.leaveWorkflow(socketId);
    }

    presence.workflowId = workflowId;
    presence.lastActive = new Date().toISOString();

    if (!this.workflowSockets.has(workflowId)) {
      this.workflowSockets.set(workflowId, new Set());
    }
    this.workflowSockets.get(workflowId)!.add(socketId);

    return presence;
  }

  public leaveWorkflow(socketId: string): { presence: UserPresence | null; oldWorkflowId: string | undefined } {
    const presence = this.socketPresence.get(socketId);
    if (!presence || !presence.workflowId) {
      return { presence: presence ?? null, oldWorkflowId: undefined };
    }

    const oldWorkflowId = presence.workflowId;
    presence.workflowId = undefined;
    presence.cursor = undefined;
    presence.nodeId = undefined;

    const set = this.workflowSockets.get(oldWorkflowId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) {
        this.workflowSockets.delete(oldWorkflowId);
      }
    }

    return { presence, oldWorkflowId };
  }

  public updateCursor(socketId: string, payload: CursorPositionPayload): UserPresence | null {
    const presence = this.socketPresence.get(socketId);
    if (!presence || presence.workflowId !== payload.workflowId) return null;

    presence.cursor = { x: payload.x, y: payload.y };
    presence.nodeId = payload.nodeId;
    presence.lastActive = new Date().toISOString();
    return presence;
  }

  public removeSocket(socketId: string): { presence: UserPresence | null; workspaceId?: string | undefined; workflowId?: string | undefined } {
    const presence = this.socketPresence.get(socketId);
    if (!presence) return { presence: null };

    const { workspaceId, workflowId } = presence;

    this.socketPresence.delete(socketId);

    if (workspaceId) {
      const wsSet = this.workspaceSockets.get(workspaceId);
      if (wsSet) {
        wsSet.delete(socketId);
        if (wsSet.size === 0) {
          this.workspaceSockets.delete(workspaceId);
        }
      }
    }

    if (workflowId) {
      const wfSet = this.workflowSockets.get(workflowId);
      if (wfSet) {
        wfSet.delete(socketId);
        if (wfSet.size === 0) {
          this.workflowSockets.delete(workflowId);
        }
      }
    }

    return { presence, workspaceId, workflowId };
  }

  public getWorkspacePresences(workspaceId: string): UserPresence[] {
    const socketIds = this.workspaceSockets.get(workspaceId);
    if (!socketIds) return [];

    const uniqueUsers = new Map<string, UserPresence>();
    for (const sId of socketIds) {
      const p = this.socketPresence.get(sId);
      if (p && (!uniqueUsers.has(p.userId) || p.workflowId)) {
        uniqueUsers.set(p.userId, p);
      }
    }
    return Array.from(uniqueUsers.values());
  }

  public getWorkflowPresences(workflowId: string): UserPresence[] {
    const socketIds = this.workflowSockets.get(workflowId);
    if (!socketIds) return [];

    const uniqueUsers = new Map<string, UserPresence>();
    for (const sId of socketIds) {
      const p = this.socketPresence.get(sId);
      if (p) {
        uniqueUsers.set(p.userId, p);
      }
    }
    return Array.from(uniqueUsers.values());
  }
}

export const presenceManager = new PresenceManager();

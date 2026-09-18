import { describe, it, expect, beforeEach } from 'vitest';
import { PresenceManager } from '../src/realtime/workspacePresence.js';
import { COLLABORATION_EVENTS } from '../src/realtime/collaborationEvents.js';

describe('Phase 7E Workspace Presence Manager', () => {
  let presenceManager: PresenceManager;

  beforeEach(() => {
    presenceManager = new PresenceManager();
  });

  describe('User Presence Registration', () => {
    it('registers user presence when socket connects to workspace', () => {
      const presence = presenceManager.addSocketPresence(
        'socket-1',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );

      expect(presence).toBeDefined();
      expect(presence.userId).toBe('user-1');
      expect(presence.email).toBe('alice@test.com');
      expect(presence.name).toBe('Alice');
      expect(presence.workspaceId).toBe('ws-1');
      expect(presence.color).toBeDefined();
      expect(presence.lastActive).toBeDefined();
    });

    it('falls back to email prefix if name is not provided', () => {
      const presence = presenceManager.addSocketPresence(
        'socket-2',
        { userId: 'user-2', email: 'bob@example.com' },
        'ws-1',
      );

      expect(presence.name).toBe('bob');
    });

    it('retrieves workspace presences correctly and avoids duplicate user entries', () => {
      presenceManager.addSocketPresence(
        'socket-1a',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );
      presenceManager.addSocketPresence(
        'socket-1b',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );
      presenceManager.addSocketPresence(
        'socket-2',
        { userId: 'user-2', email: 'bob@test.com', name: 'Bob' },
        'ws-1',
      );

      const presences = presenceManager.getWorkspacePresences('ws-1');
      expect(presences).toHaveLength(2);
      expect(presences.map(p => p.userId).sort()).toEqual(['user-1', 'user-2']);
    });

    it('isolates presences across different workspaces', () => {
      presenceManager.addSocketPresence(
        'socket-1',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );
      presenceManager.addSocketPresence(
        'socket-2',
        { userId: 'user-2', email: 'bob@test.com', name: 'Bob' },
        'ws-2',
      );

      const ws1Presences = presenceManager.getWorkspacePresences('ws-1');
      const ws2Presences = presenceManager.getWorkspacePresences('ws-2');

      expect(ws1Presences).toHaveLength(1);
      expect(ws1Presences[0]!.userId).toBe('user-1');
      expect(ws2Presences).toHaveLength(1);
      expect(ws2Presences[0]!.userId).toBe('user-2');
    });
  });

  describe('Workflow Builder Presence & Cursors', () => {
    it('tracks user joining and leaving workflow editing session', () => {
      presenceManager.addSocketPresence(
        'socket-1',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );

      const joined = presenceManager.joinWorkflow('socket-1', 'wf-1');
      expect(joined).toBeDefined();
      expect(joined?.workflowId).toBe('wf-1');

      const wfPresences = presenceManager.getWorkflowPresences('wf-1');
      expect(wfPresences).toHaveLength(1);
      expect(wfPresences[0]!.userId).toBe('user-1');

      const { presence: left, oldWorkflowId } = presenceManager.leaveWorkflow('socket-1');
      expect(oldWorkflowId).toBe('wf-1');
      expect(left?.workflowId).toBeUndefined();

      const wfPresencesAfter = presenceManager.getWorkflowPresences('wf-1');
      expect(wfPresencesAfter).toHaveLength(0);
    });

    it('tracks real-time cursor positions and node selections in workflow', () => {
      presenceManager.addSocketPresence(
        'socket-1',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );
      presenceManager.joinWorkflow('socket-1', 'wf-1');

      const updated = presenceManager.updateCursor('socket-1', {
        workflowId: 'wf-1',
        x: 250,
        y: 400,
        nodeId: 'node-step-1',
      });

      expect(updated).toBeDefined();
      expect(updated?.cursor).toEqual({ x: 250, y: 400 });
      expect(updated?.nodeId).toBe('node-step-1');
    });

    it('ignores cursor update if user is not in that workflow', () => {
      presenceManager.addSocketPresence(
        'socket-1',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );
      presenceManager.joinWorkflow('socket-1', 'wf-1');

      const updated = presenceManager.updateCursor('socket-1', {
        workflowId: 'wf-other',
        x: 100,
        y: 100,
      });

      expect(updated).toBeNull();
    });
  });

  describe('Socket Disconnection Cleanups', () => {
    it('cleans up workspace and workflow presence upon socket disconnection', () => {
      presenceManager.addSocketPresence(
        'socket-1',
        { userId: 'user-1', email: 'alice@test.com', name: 'Alice' },
        'ws-1',
      );
      presenceManager.joinWorkflow('socket-1', 'wf-1');

      const cleanup = presenceManager.removeSocket('socket-1');
      expect(cleanup.presence).toBeDefined();
      expect(cleanup.workspaceId).toBe('ws-1');
      expect(cleanup.workflowId).toBe('wf-1');

      expect(presenceManager.getWorkspacePresences('ws-1')).toHaveLength(0);
      expect(presenceManager.getWorkflowPresences('wf-1')).toHaveLength(0);
    });

    it('handles removal of unknown socket gracefully', () => {
      const cleanup = presenceManager.removeSocket('unknown-socket');
      expect(cleanup.presence).toBeNull();
    });
  });

  describe('Collaboration Event Constants', () => {
    it('defines standard collaboration events', () => {
      expect(COLLABORATION_EVENTS.PRESENCE_JOIN_WORKSPACE).toBe('presence:join-workspace');
      expect(COLLABORATION_EVENTS.PRESENCE_LEAVE_WORKSPACE).toBe('presence:leave-workspace');
      expect(COLLABORATION_EVENTS.PRESENCE_JOIN_WORKFLOW).toBe('presence:join-workflow');
      expect(COLLABORATION_EVENTS.PRESENCE_LEAVE_WORKFLOW).toBe('presence:leave-workflow');
      expect(COLLABORATION_EVENTS.PRESENCE_CURSOR_MOVE).toBe('presence:cursor-move');
      expect(COLLABORATION_EVENTS.COMMENT_CREATED).toBe('comment:created');
      expect(COLLABORATION_EVENTS.COMMENT_UPDATED).toBe('comment:updated');
      expect(COLLABORATION_EVENTS.COMMENT_DELETED).toBe('comment:deleted');
      expect(COLLABORATION_EVENTS.WORKFLOW_LOCK_ACQUIRED).toBe('workflow:lock_acquired');
      expect(COLLABORATION_EVENTS.WORKFLOW_LOCK_RELEASED).toBe('workflow:lock_released');
      expect(COLLABORATION_EVENTS.NOTIFICATION_RECEIVED).toBe('notification:received');
    });
  });
});

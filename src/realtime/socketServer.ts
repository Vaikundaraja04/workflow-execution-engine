import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server as HTTPServer } from 'http';
import type { AuthConfig } from '../auth/jwt.service.js';
import { createSocketAuthMiddleware } from './socketAuth.js';
import { COLLABORATION_EVENTS } from './collaborationEvents.js';
import type { CursorPositionPayload, NodeSelectionPayload } from './collaborationEvents.js';
import { presenceManager } from './workspacePresence.js';

let io: SocketIOServer | null = null;
let redisPubClient: Redis | null = null;
let redisSubClient: Redis | null = null;

export interface SocketServerOptions {
  auth: AuthConfig;
  redisUrl?: string;
  corsOrigins?: string[];
}

export async function initializeSocketIO(httpServer: HTTPServer, options: SocketServerOptions): Promise<SocketIOServer> {
  const socketOptions: any = {
    cors: {
      origin: options.corsOrigins && options.corsOrigins.length > 0 ? options.corsOrigins : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  };

  // Setup Redis adapter if redisUrl is configured
  if (options.redisUrl) {
    try {
      redisPubClient = new Redis(options.redisUrl);
      redisSubClient = new Redis(options.redisUrl);

      socketOptions.adapter = createAdapter(redisPubClient, redisSubClient);
    } catch (err) {
      console.warn('Socket.IO Redis adapter connection failed, falling back to in-memory adapter:', err);
    }
  }

  io = new SocketIOServer(httpServer, socketOptions);

  // Authenticate socket connections
  io.use(createSocketAuthMiddleware(options.auth));

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    // Join personal user room for direct notifications
    socket.join(`user:${user.userId}`);

    // Join workspace room & announce presence
    socket.on(COLLABORATION_EVENTS.PRESENCE_JOIN_WORKSPACE, (data: { workspaceId: string }) => {
      const { workspaceId } = data;
      if (!workspaceId) return;

      socket.join(`workspace:${workspaceId}`);
      if (!socket.data.workspaces) socket.data.workspaces = new Set();
      socket.data.workspaces.add(workspaceId);

      const presence = presenceManager.addSocketPresence(socket.id, user, workspaceId);

      // Send current workspace presences to the joining socket
      const allPresences = presenceManager.getWorkspacePresences(workspaceId);
      socket.emit(COLLABORATION_EVENTS.PRESENCE_STATE, { presences: allPresences });

      // Notify others in workspace
      socket.to(`workspace:${workspaceId}`).emit(COLLABORATION_EVENTS.PRESENCE_USER_JOINED, { presence });
    });

    // Leave workspace room
    socket.on(COLLABORATION_EVENTS.PRESENCE_LEAVE_WORKSPACE, (data: { workspaceId: string }) => {
      const { workspaceId } = data;
      if (!workspaceId) return;

      socket.leave(`workspace:${workspaceId}`);
      if (socket.data.workspaces) {
        socket.data.workspaces.delete(workspaceId);
      }

      socket.to(`workspace:${workspaceId}`).emit(COLLABORATION_EVENTS.PRESENCE_USER_LEFT, {
        userId: user.userId,
        workspaceId,
      });
    });

    // Join workflow room for active builder collaboration
    socket.on(COLLABORATION_EVENTS.PRESENCE_JOIN_WORKFLOW, (data: { workflowId: string }) => {
      const { workflowId } = data;
      if (!workflowId) return;

      socket.join(`workflow:${workflowId}`);
      socket.data.activeWorkflowId = workflowId;

      const presence = presenceManager.joinWorkflow(socket.id, workflowId);
      const workflowPresences = presenceManager.getWorkflowPresences(workflowId);

      socket.emit(COLLABORATION_EVENTS.PRESENCE_STATE, { workflowPresences });
      if (presence) {
        socket.to(`workflow:${workflowId}`).emit(COLLABORATION_EVENTS.PRESENCE_USER_JOINED, { presence });
      }
    });

    // Leave workflow room
    socket.on(COLLABORATION_EVENTS.PRESENCE_LEAVE_WORKFLOW, (data: { workflowId: string }) => {
      const { workflowId } = data;
      if (!workflowId) return;

      socket.leave(`workflow:${workflowId}`);
      socket.data.activeWorkflowId = undefined;

      const { presence } = presenceManager.leaveWorkflow(socket.id);
      socket.to(`workflow:${workflowId}`).emit(COLLABORATION_EVENTS.PRESENCE_USER_LEFT, {
        userId: user.userId,
        workflowId,
      });
    });

    // Cursor movement in workflow builder
    socket.on(COLLABORATION_EVENTS.PRESENCE_CURSOR_MOVE, (payload: CursorPositionPayload) => {
      const presence = presenceManager.updateCursor(socket.id, payload);
      if (presence && payload.workflowId) {
        socket.to(`workflow:${payload.workflowId}`).emit(COLLABORATION_EVENTS.PRESENCE_CURSOR_UPDATED, {
          userId: user.userId,
          email: user.email,
          color: presence.color,
          cursor: presence.cursor,
          nodeId: presence.nodeId,
        });
      }
    });

    // Node selection in workflow builder
    socket.on(COLLABORATION_EVENTS.PRESENCE_SELECTION_CHANGE, (payload: NodeSelectionPayload) => {
      if (payload.workflowId) {
        socket.to(`workflow:${payload.workflowId}`).emit(COLLABORATION_EVENTS.PRESENCE_SELECTION_UPDATED, {
          userId: user.userId,
          nodeIds: payload.nodeIds,
        });
      }
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
      const { presence, workspaceId, workflowId } = presenceManager.removeSocket(socket.id);
      if (presence) {
        if (workspaceId) {
          socket.to(`workspace:${workspaceId}`).emit(COLLABORATION_EVENTS.PRESENCE_USER_LEFT, {
            userId: user.userId,
            workspaceId,
          });
        }
        if (workflowId) {
          socket.to(`workflow:${workflowId}`).emit(COLLABORATION_EVENTS.PRESENCE_USER_LEFT, {
            userId: user.userId,
            workflowId,
          });
        }
      }
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitToWorkspace(workspaceId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`workspace:${workspaceId}`).emit(event, data);
}

export function emitToWorkflow(workflowId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`workflow:${workflowId}`).emit(event, data);
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

export async function closeSocketIO(): Promise<void> {
  if (io) {
    io.close();
    io = null;
  }
  if (redisPubClient) {
    await redisPubClient.quit();
  }
  if (redisSubClient) {
    await redisSubClient.quit();
  }
  redisPubClient = null;
  redisSubClient = null;
}

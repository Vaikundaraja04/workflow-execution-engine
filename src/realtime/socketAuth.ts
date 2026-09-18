import type { Socket } from 'socket.io';
import type { AuthConfig, AccessTokenPayload } from '../auth/jwt.service.js';
import { verifyAccessToken } from '../auth/jwt.service.js';

export interface AuthenticatedSocketData {
  user: AccessTokenPayload;
  workspaces: Set<string>;
  activeWorkflowId?: string;
}

export function createSocketAuthMiddleware(authConfig: AuthConfig) {
  return (socket: Socket, next: (err?: Error) => void) => {
    try {
      const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      if (!authHeader) {
        return next(new Error('AUTHENTICATION_REQUIRED'));
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
      const payload = verifyAccessToken(authConfig, token);

      socket.data.user = payload;
      socket.data.workspaces = new Set<string>();
      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'UNAUTHORIZED';
      return next(new Error(message));
    }
  };
}

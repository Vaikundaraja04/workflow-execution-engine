export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface User {
  id: string;
  _id?: string;
  email: string;
  createdAt?: string;
  updatedAt?: string;
  defaultWorkspaceId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  defaultWorkspaceId?: string;
  user?: User;
}

export interface AuthSession {
  id: string;
  sessionId?: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

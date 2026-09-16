import { apiClient } from './apiClient';
import type {
  AuthTokens,
  AuthSession,
  LoginRequest,
  RegisterRequest,
  RefreshRequest,
  User,
} from '@/types/auth';

export const authService = {
  login: async (data: LoginRequest): Promise<{
    accessToken: string;
    refreshToken: string;
    user: User;
    defaultWorkspaceId?: string;
  }> => {
    const response = await apiClient.post<
      { accessToken: string; refreshToken: string; user: User; defaultWorkspaceId?: string }
    >('/api/auth/login', data);
    return response.data;
  },

  register: async (
    data: RegisterRequest
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: User;
    defaultWorkspaceId: string;
  }> => {
    const response = await apiClient.post<
      { accessToken: string; refreshToken: string; user: User; defaultWorkspaceId: string }
    >('/api/auth/register', data);
    return response.data;
  },

  refresh: async (data: RefreshRequest): Promise<AuthTokens> => {
    const response = await apiClient.post<AuthTokens>('/api/auth/refresh', data);
    return response.data;
  },

  logout: async (refreshToken: string): Promise<void> => {
    await apiClient.post('/api/auth/logout', { refreshToken });
  },

  getCurrentUser: async (): Promise<User | null> => {
    try {
      if (typeof window !== 'undefined') {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          return JSON.parse(userStr);
        }
      }
      return null;
    } catch {
      return null;
    }
  },

  listSessions: async (): Promise<AuthSession[]> => {
    const response = await apiClient.get<AuthSession[]>('/api/auth/sessions');
    return response.data;
  },

  revokeSession: async (sessionId: string): Promise<void> => {
    await apiClient.delete(`/api/auth/sessions/${sessionId}`);
  },

  revokeAllSessions: async (): Promise<void> => {
    await apiClient.delete('/api/auth/sessions');
  },
};

export const authApi = authService;
export default authService;

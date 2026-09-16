import { create } from 'zustand';
import type { AuthTokens, User } from '@/types/auth';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  defaultWorkspaceId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (tokens: AuthTokens, user?: User) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User | null) => void;
  setDefaultWorkspaceId: (workspaceId: string | null) => void;
  clearAuth: () => void;
  initFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  defaultWorkspaceId: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: (tokens: AuthTokens, user?: User) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      if (tokens.defaultWorkspaceId) {
        localStorage.setItem('defaultWorkspaceId', tokens.defaultWorkspaceId);
      }
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
      }
    }
    set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      defaultWorkspaceId: tokens.defaultWorkspaceId ?? null,
      user: user ?? null,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  setTokens: (accessToken: string, refreshToken: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
    }
    set({ accessToken, refreshToken, isAuthenticated: true });
  },

  setUser: (user: User | null) => {
    if (typeof window !== 'undefined') {
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
      } else {
        localStorage.removeItem('user');
      }
    }
    set({ user });
  },

  setDefaultWorkspaceId: (workspaceId: string | null) => {
    if (typeof window !== 'undefined') {
      if (workspaceId) {
        localStorage.setItem('defaultWorkspaceId', workspaceId);
      } else {
        localStorage.removeItem('defaultWorkspaceId');
      }
    }
    set({ defaultWorkspaceId: workspaceId });
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('defaultWorkspaceId');
      localStorage.removeItem('user');
      localStorage.removeItem('currentWorkspaceId');
    }
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      defaultWorkspaceId: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  initFromStorage: () => {
    if (typeof window === 'undefined') {
      set({ isLoading: false });
      return;
    }

    try {
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      const defaultWorkspaceId = localStorage.getItem('defaultWorkspaceId');
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : null;

      if (accessToken && refreshToken) {
        set({
          accessToken,
          refreshToken,
          defaultWorkspaceId,
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          defaultWorkspaceId: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    } catch {
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        defaultWorkspaceId: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
}));

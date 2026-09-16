import { create } from 'zustand';
import type { Workspace, WorkspaceRole } from '@/types/workspace';

interface WorkspaceState {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  currentRole: WorkspaceRole | null;
  isLoading: boolean;
  error: string | null;

  setCurrentWorkspace: (workspace: Workspace | null) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setCurrentRole: (role: WorkspaceRole | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearWorkspaces: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentWorkspace: null,
  workspaces: [],
  currentRole: null,
  isLoading: false,
  error: null,

  setCurrentWorkspace: (workspace: Workspace | null) => {
    if (typeof window !== 'undefined') {
      if (workspace) {
        const id = workspace._id || workspace.id || '';
        localStorage.setItem('currentWorkspaceId', id);
      } else {
        localStorage.removeItem('currentWorkspaceId');
      }
    }
    set({
      currentWorkspace: workspace,
      currentRole: workspace?.role ?? null,
    });
  },

  setWorkspaces: (workspaces: Workspace[]) => {
    set({ workspaces });
  },

  setCurrentRole: (currentRole: WorkspaceRole | null) => {
    set({ currentRole });
  },

  setLoading: (isLoading: boolean) => {
    set({ isLoading });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  clearWorkspaces: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('currentWorkspaceId');
    }
    set({
      currentWorkspace: null,
      workspaces: [],
      currentRole: null,
      isLoading: false,
      error: null,
    });
  },
}));

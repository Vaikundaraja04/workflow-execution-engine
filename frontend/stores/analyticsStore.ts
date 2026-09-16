import { create } from 'zustand';
import type {
  ExecutionMetrics,
  WorkflowAnalytics,
  WorkspaceAnalytics,
} from '@/types/analytics';

interface AnalyticsState {
  metrics: ExecutionMetrics | null;
  workflowAnalytics: Record<string, WorkflowAnalytics>; // workflowId => analytics
  workspaceAnalytics: WorkspaceAnalytics | null;
  loading: boolean;
  error: string | null;

  setMetrics: (metrics: ExecutionMetrics | null) => void;
  setWorkflowAnalytics: (workflowId: string, analytics: WorkflowAnalytics) => void;
  setWorkspaceAnalytics: (analytics: WorkspaceAnalytics | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  metrics: null,
  workflowAnalytics: {},
  workspaceAnalytics: null,
  loading: false,
  error: null,

  setMetrics: (metrics: ExecutionMetrics | null) => set({ metrics }),
  setWorkflowAnalytics: (workflowId: string, analytics: WorkflowAnalytics) =>
    set((state) => ({
      workflowAnalytics: { ...state.workflowAnalytics, [workflowId]: analytics },
    })),
  setWorkspaceAnalytics: (analytics: WorkspaceAnalytics | null) =>
    set({ workspaceAnalytics: analytics }),
  setLoading: (isLoading: boolean) => set({ loading: isLoading }),
  setError: (error: string | null) => set({ error: error }),
  clear: () =>
    set({
      metrics: null,
      workflowAnalytics: {},
      workspaceAnalytics: null,
      loading: false,
      error: null,
    }),
}));
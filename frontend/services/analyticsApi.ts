import { apiClient } from './apiClient';
import type {
  ExecutionMetrics,
  WorkflowAnalytics,
  WorkspaceAnalytics,
} from '@/types/analytics';

export const analyticsApi = {
  getWorkspaceAnalytics: async (workspaceId: string): Promise<WorkspaceAnalytics> => {
    const response = await apiClient.get<WorkspaceAnalytics>(
      `/api/analytics/workspaces/${workspaceId}`
    );
    return response.data;
  },

  getWorkflowAnalytics: async (
    workflowId: string,
    workspaceId?: string
  ): Promise<WorkflowAnalytics> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<WorkflowAnalytics>(
      `/api/analytics/workflows/${workflowId}`,
      config
    );
    return response.data;
  },

  getExecutionMetrics: async (
    executionId: string,
    workspaceId?: string
  ): Promise<ExecutionMetrics> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<ExecutionMetrics>(
      `/api/analytics/executions/${executionId}`,
      config
    );
    return response.data;
  },
};

export default analyticsApi;

import { apiClient } from './apiClient';
import type {
  WorkflowExecution,
  DeadLetter,
  CreateExecutionPayload,
} from '@/types/execution';

export const executionApi = {
  listExecutions: async (
    workflowId: string,
    workspaceId?: string
  ): Promise<WorkflowExecution[]> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<WorkflowExecution[]>(
      `/api/workflows/${workflowId}/executions`,
      config
    );
    return response.data;
  },

  getExecution: async (
    executionId: string,
    workspaceId?: string
  ): Promise<WorkflowExecution> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<WorkflowExecution>(
      `/api/executions/${executionId}`,
      config
    );
    return response.data;
  },

  createExecution: async (
    workflowId: string,
    payload: CreateExecutionPayload = {},
    workspaceId?: string
  ): Promise<WorkflowExecution> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<WorkflowExecution>(
      `/api/workflows/${workflowId}/executions`,
      payload,
      config
    );
    return response.data;
  },

  replayExecution: async (
    executionId: string,
    workspaceId?: string
  ): Promise<WorkflowExecution> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<WorkflowExecution>(
      `/api/executions/${executionId}/replay`,
      {},
      config
    );
    return response.data;
  },

  cancelExecution: async (
    executionId: string,
    reason?: string,
    workspaceId?: string
  ): Promise<WorkflowExecution> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<WorkflowExecution>(
      `/api/executions/${executionId}/cancel`,
      { reason },
      config
    );
    return response.data;
  },

  listDeadLetters: async (
    workflowId: string,
    workspaceId?: string
  ): Promise<DeadLetter[]> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<DeadLetter[]>(
      `/api/workflows/${workflowId}/dead-letters`,
      config
    );
    return response.data;
  },
};

export default executionApi;

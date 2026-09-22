import { apiClient } from './apiClient';
import type {
  WorkflowExecution,
  DeadLetter,
  CreateExecutionPayload,
} from '@/types/execution';

const normalizeExecution = (execution: WorkflowExecution): WorkflowExecution => ({
  ...execution,
  _id: execution._id || execution.executionId || execution.id || '',
  id: execution.id || execution.executionId || execution._id || '',
  version: execution.version ?? execution.versionNumber ?? 1,
});

const createIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
};

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
    return response.data.map(normalizeExecution);
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
    return normalizeExecution(response.data);
  },

  createExecution: async (
    workflowId: string,
    payload: CreateExecutionPayload = {},
    workspaceId?: string
  ): Promise<WorkflowExecution> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const body: Record<string, unknown> = { idempotencyKey: createIdempotencyKey() };
    const initialInput = payload.initialInput ?? {};
    if (Object.keys(initialInput).length > 0) {
      body.input = initialInput;
    }
    const response = await apiClient.post<WorkflowExecution>(
      '/api/workflows/' + workflowId + '/executions',
      body,
      config
    );
    return normalizeExecution(response.data);
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
    return normalizeExecution(response.data);
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
    return normalizeExecution(response.data);
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

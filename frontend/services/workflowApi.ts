import { apiClient } from './apiClient';
import type {
  Workflow,
  CreateWorkflowPayload,
  UpdateWorkflowDraftPayload,
} from '@/types/workflow';

export const workflowApi = {
  listWorkflows: async (workspaceId?: string): Promise<Workflow[]> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<Workflow[]>('/api/workflows', config);
    return response.data;
  },

  getWorkflow: async (id: string, workspaceId?: string): Promise<Workflow> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<Workflow>(`/api/workflows/${id}`, config);
    return response.data;
  },

  createWorkflow: async (
    payload: CreateWorkflowPayload,
    workspaceId?: string
  ): Promise<Workflow> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<Workflow>('/api/workflows', payload, config);
    return response.data;
  },

  updateDraft: async (
    id: string,
    payload: UpdateWorkflowDraftPayload,
    workspaceId?: string
  ): Promise<Workflow> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.put<Workflow>(
      `/api/workflows/${id}/draft`,
      payload,
      config
    );
    return response.data;
  },

  validateDraft: async (
    id: string,
    workspaceId?: string
  ): Promise<{ valid: boolean; errors?: string[] }> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<{ valid: boolean; errors?: string[] }>(
      `/api/workflows/${id}/validate`,
      {},
      config
    );
    return response.data;
  },

  publishWorkflow: async (
    id: string,
    changeSummary?: string,
    workspaceId?: string
  ): Promise<Workflow> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<Workflow>(
      `/api/workflows/${id}/publish`,
      { changeSummary },
      config
    );
    return response.data;
  },
};

export default workflowApi;

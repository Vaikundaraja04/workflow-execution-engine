import { apiClient } from './apiClient';
import type {
  Workflow,
  CreateWorkflowPayload,
  UpdateWorkflowDraftPayload,
  WorkflowVersionView,
  VersionComparison,
  ValidationResponse,
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
  ): Promise<ValidationResponse> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<ValidationResponse>(
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
  ): Promise<{ workflowId: string; versionNumber: number; definitionHash: string }> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<{ workflowId: string; versionNumber: number; definitionHash: string }>(
      `/api/workflows/${id}/publish`,
      { changeSummary },
      config
    );
    return response.data;
  },

  listVersions: async (
    id: string,
    workspaceId?: string
  ): Promise<WorkflowVersionView[]> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<WorkflowVersionView[]>(
      `/api/workflows/${id}/versions`,
      config
    );
    return response.data;
  },

  getVersion: async (
    id: string,
    versionId: string,
    workspaceId?: string
  ): Promise<WorkflowVersionView> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<WorkflowVersionView>(
      `/api/workflows/${id}/versions/${versionId}`,
      config
    );
    return response.data;
  },

  restoreVersion: async (
    id: string,
    versionId: string,
    changeSummary?: string,
    workspaceId?: string
  ): Promise<WorkflowVersionView> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<WorkflowVersionView>(
      `/api/workflows/${id}/versions/${versionId}/restore`,
      { changeSummary },
      config
    );
    return response.data;
  },

  compareVersions: async (
    id: string,
    from: string | number,
    to: string | number,
    workspaceId?: string
  ): Promise<VersionComparison> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<VersionComparison>(
      `/api/workflows/${id}/compare`,
      { from, to },
      config
    );
    return response.data;
  },
};

export default workflowApi;

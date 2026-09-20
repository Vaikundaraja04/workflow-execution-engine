import { apiClient } from './apiClient';
import type {
  CreateSelfHealingPolicyPayload,
  SelfHealingIncidentDTO,
  SelfHealingIncidentFilters,
  SelfHealingPolicyDTO,
  UpdateSelfHealingPolicyPayload,
} from '@/types/aiOperations';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

/**
 * Module 12A — Autonomous Self-Healing API client.
 * Backend routes are mounted under `/api/v1/self-healing` and wrap all
 * payloads in a `{ data }` envelope.
 */
export const selfHealingApi = {
  listPolicies: async (workspaceId?: string): Promise<SelfHealingPolicyDTO[]> => {
    const response = await apiClient.get<{ data: SelfHealingPolicyDTO[] }>(
      '/api/v1/self-healing/policies',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  createPolicy: async (
    payload: CreateSelfHealingPolicyPayload,
    workspaceId?: string
  ): Promise<SelfHealingPolicyDTO> => {
    const response = await apiClient.post<{ data: SelfHealingPolicyDTO }>(
      '/api/v1/self-healing/policies',
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  updatePolicy: async (
    id: string,
    payload: UpdateSelfHealingPolicyPayload,
    workspaceId?: string
  ): Promise<SelfHealingPolicyDTO> => {
    const response = await apiClient.put<{ data: SelfHealingPolicyDTO }>(
      `/api/v1/self-healing/policies/${id}`,
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  deletePolicy: async (id: string, workspaceId?: string): Promise<void> => {
    await apiClient.delete(
      `/api/v1/self-healing/policies/${id}`,
      workspaceConfig(workspaceId)
    );
  },

  listIncidents: async (
    filters: SelfHealingIncidentFilters = {},
    workspaceId?: string
  ): Promise<SelfHealingIncidentDTO[]> => {
    const params: Record<string, string> = {};
    if (filters.status) params.status = filters.status;
    if (filters.executionId) params.executionId = filters.executionId;

    const response = await apiClient.get<{ data: SelfHealingIncidentDTO[] }>(
      '/api/v1/self-healing/incidents',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getIncident: async (id: string, workspaceId?: string): Promise<SelfHealingIncidentDTO> => {
    const response = await apiClient.get<{ data: SelfHealingIncidentDTO }>(
      `/api/v1/self-healing/incidents/${id}`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  evaluateExecutionFailure: async (
    executionId: string,
    options: { forceApproval?: boolean } = {},
    workspaceId?: string
  ): Promise<SelfHealingIncidentDTO> => {
    const response = await apiClient.post<{ data: SelfHealingIncidentDTO }>(
      `/api/v1/self-healing/evaluate/${executionId}`,
      { forceApproval: options.forceApproval === true },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  approveIncident: async (
    id: string,
    token?: string,
    workspaceId?: string
  ): Promise<SelfHealingIncidentDTO> => {
    const response = await apiClient.post<{ data: SelfHealingIncidentDTO }>(
      `/api/v1/self-healing/incidents/${id}/approve`,
      token ? { token } : {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  rejectIncident: async (
    id: string,
    reason?: string,
    workspaceId?: string
  ): Promise<SelfHealingIncidentDTO> => {
    const response = await apiClient.post<{ data: SelfHealingIncidentDTO }>(
      `/api/v1/self-healing/incidents/${id}/reject`,
      reason !== undefined ? { reason } : {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};

export default selfHealingApi;

import { apiClient } from './apiClient';
import type {
  PredictiveAnomalyDTO,
  PredictiveAnomalyFilters,
  WorkflowOptimization,
  WorkflowOptimizationResultDTO,
} from '@/types/aiOperations';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

/**
 * Module 12D — Predictive Operations & Autonomous Optimization API client.
 * Backend routes are mounted under `/api/v1/predictive-operations` and wrap
 * all payloads in a `{ data }` envelope.
 */
export const predictiveOpsApi = {
  listAnomalies: async (
    filters: PredictiveAnomalyFilters = {},
    workspaceId?: string
  ): Promise<PredictiveAnomalyDTO[]> => {
    const params: Record<string, string> = {};
    if (filters.workflowId) params.workflowId = filters.workflowId;
    if (filters.anomalyType) params.anomalyType = filters.anomalyType;
    if (filters.severity) params.severity = filters.severity;
    if (filters.isAcknowledged !== undefined) {
      params.isAcknowledged = filters.isAcknowledged ? 'true' : 'false';
    }
    if (filters.startTime) params.startTime = filters.startTime;
    if (filters.endTime) params.endTime = filters.endTime;

    const response = await apiClient.get<{ data: PredictiveAnomalyDTO[] }>(
      '/api/v1/predictive-operations/anomalies',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  acknowledgeAnomaly: async (id: string, workspaceId?: string): Promise<PredictiveAnomalyDTO> => {
    const response = await apiClient.patch<{ data: PredictiveAnomalyDTO }>(
      `/api/v1/predictive-operations/anomalies/${id}/acknowledge`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  deleteAnomaly: async (id: string, workspaceId?: string): Promise<void> => {
    await apiClient.delete(
      `/api/v1/predictive-operations/anomalies/${id}`,
      workspaceConfig(workspaceId)
    );
  },

  getWorkflowOptimizations: async (
    workflowId: string,
    workspaceId?: string
  ): Promise<WorkflowOptimizationResultDTO> => {
    const response = await apiClient.get<{ data: WorkflowOptimizationResultDTO }>(
      `/api/v1/predictive-operations/workflows/${workflowId}/optimizations`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  applyWorkflowOptimizations: async (
    workflowId: string,
    optimizations: WorkflowOptimization[],
    workspaceId?: string
  ): Promise<{ workflowId: string }> => {
    const response = await apiClient.post<{ data: { workflowId: string } }>(
      `/api/v1/predictive-operations/workflows/${workflowId}/optimizations/apply`,
      { optimizations },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};

export default predictiveOpsApi;

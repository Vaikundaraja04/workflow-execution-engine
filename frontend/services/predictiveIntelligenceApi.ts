import { apiClient } from './apiClient';
import type {
  FailurePredictionResult,
  PerformancePredictionResult,
  CapacityPredictionResult,
  CostPredictionResult,
  IPredictionAlert,
} from '@/types/predictiveIntelligence';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

export const predictiveIntelligenceApi = {
  getFailurePredictions: async (
    workspaceId: string,
    horizon?: string,
    workflowId?: string
  ): Promise<FailurePredictionResult> => {
    const params: Record<string, string> = { horizon: horizon || '24h' };
    if (workflowId) params.workflowId = workflowId;

    const response = await apiClient.get<{ data: FailurePredictionResult }>(
      '/api/v1/predictive-intelligence/failures',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getPerformancePredictions: async (
    workspaceId: string,
    horizon?: string,
    workflowId?: string
  ): Promise<PerformancePredictionResult> => {
    const params: Record<string, string> = { horizon: horizon || '24h' };
    if (workflowId) params.workflowId = workflowId;

    const response = await apiClient.get<{ data: PerformancePredictionResult }>(
      '/api/v1/predictive-intelligence/performance',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getCapacityPredictions: async (
    workspaceId: string,
    horizon?: string
  ): Promise<CapacityPredictionResult> => {
    const params: Record<string, string> = { horizon: horizon || '24h' };

    const response = await apiClient.get<{ data: CapacityPredictionResult }>(
      '/api/v1/predictive-intelligence/capacity',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getCostPredictions: async (
    workspaceId: string,
    horizon?: string
  ): Promise<CostPredictionResult> => {
    const params: Record<string, string> = { horizon: horizon || '24h' };

    const response = await apiClient.get<{ data: CostPredictionResult }>(
      '/api/v1/predictive-intelligence/cost',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getAlerts: async (
    workspaceId: string,
    filters?: { type?: string; severity?: string; status?: string }
  ): Promise<IPredictionAlert[]> => {
    const params: Record<string, string> = {};
    if (filters?.type) params.type = filters.type;
    if (filters?.severity) params.severity = filters.severity;
    if (filters?.status) params.status = filters.status;

    const response = await apiClient.get<{ data: IPredictionAlert[] }>(
      '/api/v1/predictive-intelligence/alerts',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  acknowledgeAlert: async (
    alertId: string,
    workspaceId: string,
    note?: string
  ): Promise<IPredictionAlert> => {
    const response = await apiClient.post<{ data: IPredictionAlert }>(
      `/api/v1/predictive-intelligence/alerts/${alertId}/acknowledge`,
      { note },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  resolveAlert: async (
    alertId: string,
    workspaceId: string
  ): Promise<IPredictionAlert> => {
    const response = await apiClient.post<{ data: IPredictionAlert }>(
      `/api/v1/predictive-intelligence/alerts/${alertId}/resolve`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  dismissAlert: async (
    alertId: string,
    workspaceId: string
  ): Promise<IPredictionAlert> => {
    const response = await apiClient.post<{ data: IPredictionAlert }>(
      `/api/v1/predictive-intelligence/alerts/${alertId}/dismiss`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  runPredictionCycle: async (
    workspaceId: string
  ): Promise<{
    failure: FailurePredictionResult;
    performance: PerformancePredictionResult;
    capacity: CapacityPredictionResult;
    cost: CostPredictionResult;
    alerts: IPredictionAlert[];
  }> => {
    const response = await apiClient.post<{
      data: {
        failure: FailurePredictionResult;
        performance: PerformancePredictionResult;
        capacity: CapacityPredictionResult;
        cost: CostPredictionResult;
        alerts: IPredictionAlert[];
      };
    }>(
      '/api/v1/predictive-intelligence/run-cycle',
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};

export default predictiveIntelligenceApi;
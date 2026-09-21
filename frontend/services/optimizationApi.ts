import { apiClient } from './apiClient';
import type {
  IWorkflowOptimizationPlan,
  WorkflowAnalysisResult,
} from '@/types/optimization';
import type { VersionComparison } from '@/types/workflow';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

export const optimizationApi = {
  analyzeWorkflow: async (workflowId: string, workspaceId: string): Promise<WorkflowAnalysisResult> => {
    const response = await apiClient.get<{ data: WorkflowAnalysisResult }>(
      `/api/v1/optimization/workflows/${workflowId}/analyze`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  generatePlan: async (workflowId: string, workspaceId: string): Promise<IWorkflowOptimizationPlan> => {
    const response = await apiClient.post<{ data: IWorkflowOptimizationPlan }>(
      `/api/v1/optimization/workflows/${workflowId}/generate-plan`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  listPlans: async (
    workspaceId: string,
    filters?: { status?: string; workflowId?: string }
  ): Promise<IWorkflowOptimizationPlan[]> => {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.workflowId) params.workflowId = filters.workflowId;

    const response = await apiClient.get<{ data: IWorkflowOptimizationPlan[] }>(
      '/api/v1/optimization/plans',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getPlan: async (planId: string, workspaceId: string): Promise<IWorkflowOptimizationPlan> => {
    const response = await apiClient.get<{ data: IWorkflowOptimizationPlan }>(
      `/api/v1/optimization/plans/${planId}`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  approvePlan: async (planId: string, workspaceId: string, note?: string): Promise<IWorkflowOptimizationPlan> => {
    const response = await apiClient.post<{ data: IWorkflowOptimizationPlan }>(
      `/api/v1/optimization/plans/${planId}/approve`,
      { note },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  rejectPlan: async (planId: string, workspaceId: string, reason?: string): Promise<IWorkflowOptimizationPlan> => {
    const response = await apiClient.post<{ data: IWorkflowOptimizationPlan }>(
      `/api/v1/optimization/plans/${planId}/reject`,
      { reason },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  applyPlan: async (
    planId: string,
    workspaceId: string
  ): Promise<{
    plan: IWorkflowOptimizationPlan;
    version: { id: string; versionNumber: number; status: string } | null;
    beforeAfter: VersionComparison | null;
  }> => {
    const response = await apiClient.post<{
      data: {
        plan: IWorkflowOptimizationPlan;
        version: { id: string; versionNumber: number; status: string } | null;
        beforeAfter: VersionComparison | null;
      };
    }>(
      `/api/v1/optimization/plans/${planId}/apply`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};

export default optimizationApi;
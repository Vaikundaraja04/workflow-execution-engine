import { apiClient } from './apiClient';
import type {
  AIGenerateWorkflowResult,
  AIGenerateTemplateResult,
  AIExecutionAnalysis,
  AIOptimizationResult,
  AIUsageSummary,
  AIUsageRecord,
  AIUsageFeatureSummary,
  AIConfiguration,
  AIUpdateConfigurationPayload,
} from '@/features/ai/types/types';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

/**
 * Aggregates raw AI usage records returned by GET /api/v1/ai/usage.
 */
export function summarizeAIUsage(records: AIUsageRecord[]): AIUsageSummary {
  const featureMap = new Map<string, AIUsageFeatureSummary>();
  let totalRequests = 0;
  let totalTokens = 0;
  let estimatedCost = 0;

  for (const record of records) {
    const requests = record.requests ?? 1;
    const tokens = record.tokensUsed ?? 0;
    const cost = record.costEstimate ?? 0;

    totalRequests += requests;
    totalTokens += tokens;
    estimatedCost += cost;

    const existing = featureMap.get(record.feature);
    if (existing) {
      existing.requests += requests;
      existing.tokens += tokens;
      existing.cost += cost;
    } else {
      featureMap.set(record.feature, {
        feature: record.feature,
        requests,
        tokens,
        cost,
      });
    }
  }

  return {
    totalRequests,
    totalTokens,
    estimatedCost,
    featureUsage: Array.from(featureMap.values()),
    records,
    latestActivity: records[0]?.createdAt ?? null,
  };
}
export const aiApi = {
  generateWorkflow: async (
    prompt: string,
    workspaceId?: string
  ): Promise<AIGenerateWorkflowResult> => {
    const response = await apiClient.post<AIGenerateWorkflowResult>(
      '/api/v1/ai/workflows/generate',
      { prompt },
      workspaceConfig(workspaceId)
    );
    return response.data;
  },

  generateTemplate: async (
    prompt: string,
    workspaceId?: string
  ): Promise<AIGenerateTemplateResult> => {
    const response = await apiClient.post<AIGenerateTemplateResult>(
      '/api/v1/ai/templates/generate',
      { prompt },
      workspaceConfig(workspaceId)
    );
    return response.data;
  },

  analyzeExecution: async (
    executionId: string,
    workspaceId?: string
  ): Promise<AIExecutionAnalysis> => {
    const response = await apiClient.get<AIExecutionAnalysis>(
      `/api/v1/ai/executions/${executionId}/analyze`,
      workspaceConfig(workspaceId)
    );
    return response.data;
  },

  optimizeWorkflow: async (
    workflowId: string,
    workspaceId?: string
  ): Promise<AIOptimizationResult> => {
    const response = await apiClient.post<AIOptimizationResult>(
      `/api/v1/ai/workflows/${workflowId}/optimize`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data;
  },

  getAIUsage: async (workspaceId?: string): Promise<AIUsageSummary> => {
    const response = await apiClient.get<AIUsageRecord[]>(
      '/api/v1/ai/usage',
      workspaceConfig(workspaceId)
    );
    return summarizeAIUsage(Array.isArray(response.data) ? response.data : []);
  },

  getAIConfig: async (workspaceId?: string): Promise<AIConfiguration> => {
    const response = await apiClient.get<AIConfiguration>(
      '/api/v1/admin/ai/config',
      workspaceConfig(workspaceId)
    );
    return response.data;
  },

  updateAIConfig: async (
    payload: AIUpdateConfigurationPayload,
    workspaceId?: string
  ): Promise<AIConfiguration> => {
    const response = await apiClient.patch<AIConfiguration>(
      '/api/v1/admin/ai/config',
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data;
  },
};

export default aiApi;

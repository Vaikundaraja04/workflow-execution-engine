import { apiClient } from './apiClient';
import type {
  AIGovernanceBudgetDTO,
  AIModelRouteResultDTO,
  AIModelRouterConfigDTO,
  AIPromptSanitizeResultDTO,
  UpdateAIGovernanceBudgetPayload,
  UpdateAIModelRouterConfigPayload,
} from '@/types/aiOperations';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

/**
 * Module 12C — AI Governance & Multi-Model Router API client.
 * Backend routes are mounted under `/api/v1/ai/governance` and wrap all
 * payloads in a `{ data }` envelope.
 */
export const aiGovernanceApi = {
  getBudget: async (workspaceId?: string): Promise<AIGovernanceBudgetDTO> => {
    const response = await apiClient.get<{ data: AIGovernanceBudgetDTO }>(
      '/api/v1/ai/governance/budget',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  updateBudget: async (
    payload: UpdateAIGovernanceBudgetPayload,
    workspaceId?: string
  ): Promise<AIGovernanceBudgetDTO> => {
    const response = await apiClient.put<{ data: AIGovernanceBudgetDTO }>(
      '/api/v1/ai/governance/budget',
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  resetBudgetUsage: async (workspaceId?: string): Promise<AIGovernanceBudgetDTO> => {
    const response = await apiClient.post<{ data: AIGovernanceBudgetDTO }>(
      '/api/v1/ai/governance/budget/reset',
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getRouterConfig: async (workspaceId?: string): Promise<AIModelRouterConfigDTO> => {
    const response = await apiClient.get<{ data: AIModelRouterConfigDTO }>(
      '/api/v1/ai/governance/router/config',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  updateRouterConfig: async (
    payload: UpdateAIModelRouterConfigPayload,
    workspaceId?: string
  ): Promise<AIModelRouterConfigDTO> => {
    const response = await apiClient.put<{ data: AIModelRouterConfigDTO }>(
      '/api/v1/ai/governance/router/config',
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  routePrompt: async (
    prompt: string,
    feature = 'workflow_generation',
    workspaceId?: string
  ): Promise<AIModelRouteResultDTO> => {
    const response = await apiClient.post<{ data: AIModelRouteResultDTO }>(
      '/api/v1/ai/governance/router/route',
      { prompt, feature },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  sanitizePrompt: async (
    prompt: string,
    workspaceId?: string
  ): Promise<AIPromptSanitizeResultDTO> => {
    const response = await apiClient.post<{ data: AIPromptSanitizeResultDTO }>(
      '/api/v1/ai/governance/sanitize',
      { prompt },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};

export default aiGovernanceApi;

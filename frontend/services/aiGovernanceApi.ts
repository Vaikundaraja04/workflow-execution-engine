import { apiClient } from './apiClient';
import type {
  AIOperationApprovalDTO,
  GovernanceAuditEventDTO,
  GovernanceAuditSummaryDTO,
  GovernanceDecisionDTO,
  GovernancePolicyDTO,
  GovernancePolicyType,
} from '@/types/aiGovernancePolicy';
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
/**
 * Phase 12.6 - governance policy, evaluation, audit and approval endpoints.
 * Mounted under /api/v1/ai/governance (same base as the Module 12C endpoints).
 */
export const aiGovernancePolicyApi = {
  listPolicies: async (type?: GovernancePolicyType, workspaceId?: string): Promise<GovernancePolicyDTO[]> => {
    const params: Record<string, string> = {};
    if (type) params.type = type;
    const response = await apiClient.get<{ data: GovernancePolicyDTO[] }>('/api/v1/ai/governance/policies', {
      ...(workspaceConfig(workspaceId) ?? {}),
      params,
    });
    return response.data.data;
  },

  createPolicy: async (
    payload: Record<string, unknown> & { type: GovernancePolicyType },
    workspaceId?: string
  ): Promise<GovernancePolicyDTO> => {
    const response = await apiClient.post<{ data: GovernancePolicyDTO }>(
      '/api/v1/ai/governance/policies',
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  updatePolicy: async (
    policyId: string,
    payload: Record<string, unknown>,
    workspaceId?: string
  ): Promise<GovernancePolicyDTO> => {
    const response = await apiClient.put<{ data: GovernancePolicyDTO }>(
      `/api/v1/ai/governance/policies/${policyId}`,
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  deletePolicy: async (policyId: string, workspaceId?: string): Promise<{ deleted: boolean }> => {
    const response = await apiClient.delete<{ data: { deleted: boolean } }>(
      `/api/v1/ai/governance/policies/${policyId}`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
  evaluate: async (payload: Record<string, unknown>, workspaceId?: string): Promise<GovernanceDecisionDTO> => {
    const response = await apiClient.post<{ data: GovernanceDecisionDTO }>(
      '/api/v1/ai/governance/evaluate',
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getAuditEvents: async (
    workspaceId?: string,
    limit = 50,
    action?: string
  ): Promise<GovernanceAuditEventDTO[]> => {
    const params: Record<string, string | number> = { limit };
    if (action) params.action = action;
    const response = await apiClient.get<{ data: GovernanceAuditEventDTO[] }>(
      '/api/v1/ai/governance/audit/events',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getAuditSummary: async (workspaceId?: string, timeframe = '24h'): Promise<GovernanceAuditSummaryDTO> => {
    const response = await apiClient.get<{ data: GovernanceAuditSummaryDTO }>(
      '/api/v1/ai/governance/audit/summary',
      { ...(workspaceConfig(workspaceId) ?? {}), params: { timeframe } }
    );
    return response.data.data;
  },

  listApprovals: async (workspaceId?: string, status?: string): Promise<AIOperationApprovalDTO[]> => {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    const response = await apiClient.get<{ data: AIOperationApprovalDTO[] }>(
      '/api/v1/ai/governance/approvals',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  approveApproval: async (
    approvalId: string,
    workspaceId?: string,
    reason?: string
  ): Promise<AIOperationApprovalDTO> => {
    const response = await apiClient.post<{ data: AIOperationApprovalDTO }>(
      `/api/v1/ai/governance/approvals/${approvalId}/approve`,
      { reason },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  rejectApproval: async (
    approvalId: string,
    workspaceId?: string,
    reason?: string
  ): Promise<AIOperationApprovalDTO> => {
    const response = await apiClient.post<{ data: AIOperationApprovalDTO }>(
      `/api/v1/ai/governance/approvals/${approvalId}/reject`,
      { reason },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};
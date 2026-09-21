import { apiClient } from './apiClient';
import type {
  AgentMarketplaceDetailsDTO,
  AgentMarketplaceListingDTO,
  AgentMarketplaceSearchParams,
  AgentMarketplaceSearchResultDTO,
  AgentMarketplaceStatsDTO,
  AgentReviewListDTO,
  AgentReviewDTO,
  AgentHealthResponseDTO,
  AgentVersionComparisonDTO,
  AgentVersionDTO,
  MarketplaceAnalyticsDTO,
  MarketplaceLifecycleDTO,
  MarketplaceRecommendationsDTO,
  InstallAgentConfigurationDTO,
  InstallAgentResultDTO,
} from '@/types/agentMarketplace';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

/**
 * Phase 12.7 - Enterprise AI Agent Marketplace API client.
 * Backend routes are mounted under /api/v1/agent-marketplace and wrap all
 * payloads in a { data } envelope.
 */
export const agentMarketplaceApi = {
  searchAgents: async (
    workspaceId?: string,
    params: AgentMarketplaceSearchParams = {}
  ): Promise<AgentMarketplaceSearchResultDTO> => {
    const response = await apiClient.get<{ data: AgentMarketplaceSearchResultDTO }>(
      '/api/v1/agent-marketplace/agents',
      { ...(workspaceConfig(workspaceId) ?? {}), params }
    );
    return response.data.data;
  },

  getAgentDetails: async (listingId: string, workspaceId?: string): Promise<AgentMarketplaceDetailsDTO> => {
    const response = await apiClient.get<{ data: AgentMarketplaceDetailsDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
  createListing: async (
    payload: Record<string, unknown> & { agentId: string },
    workspaceId?: string
  ): Promise<AgentMarketplaceListingDTO> => {
    const response = await apiClient.post<{ data: AgentMarketplaceListingDTO }>(
      '/api/v1/agent-marketplace/agents',
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  updateListing: async (
    listingId: string,
    payload: Record<string, unknown>,
    workspaceId?: string
  ): Promise<AgentMarketplaceListingDTO> => {
    const response = await apiClient.put<{ data: AgentMarketplaceListingDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}`,
      payload,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  publishAgent: async (listingId: string, workspaceId?: string): Promise<AgentMarketplaceListingDTO> => {
    const response = await apiClient.post<{ data: AgentMarketplaceListingDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}/publish`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  archiveAgent: async (listingId: string, workspaceId?: string): Promise<AgentMarketplaceListingDTO> => {
    const response = await apiClient.post<{ data: AgentMarketplaceListingDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}/archive`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
  listVersions: async (listingId: string, workspaceId?: string): Promise<AgentVersionDTO[]> => {
    const response = await apiClient.get<{ data: AgentVersionDTO[] }>(
      `/api/v1/agent-marketplace/agents/${listingId}/versions`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  compareVersions: async (
    listingId: string,
    from: number,
    to: number,
    workspaceId?: string
  ): Promise<AgentVersionComparisonDTO> => {
    const response = await apiClient.get<{ data: AgentVersionComparisonDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}/versions/compare`,
      { ...(workspaceConfig(workspaceId) ?? {}), params: { from, to } }
    );
    return response.data.data;
  },

  rollbackVersion: async (
    listingId: string,
    version: number,
    workspaceId?: string
  ): Promise<AgentVersionDTO> => {
    const response = await apiClient.post<{ data: AgentVersionDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}/rollback`,
      { version },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  installAgent: async (
    listingId: string,
    configuration: InstallAgentConfigurationDTO = {},
    workspaceId?: string
  ): Promise<InstallAgentResultDTO> => {
    const response = await apiClient.post<{ data: InstallAgentResultDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}/install`,
      { configuration },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  uninstallAgent: async (
    listingId: string,
    workspaceId?: string
  ): Promise<{ uninstalled: boolean; localAgentId: string }> => {
    const response = await apiClient.delete<{ data: { uninstalled: boolean; localAgentId: string } }>(
      `/api/v1/agent-marketplace/agents/${listingId}/install`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
  createReview: async (
    listingId: string,
    rating: number,
    review?: string,
    workspaceId?: string
  ): Promise<{ review: AgentReviewDTO; rating: { average: number; count: number } }> => {
    const response = await apiClient.post<{
      data: { review: AgentReviewDTO; rating: { average: number; count: number } };
    }>(
      `/api/v1/agent-marketplace/agents/${listingId}/reviews`,
      { rating, review },
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  listReviews: async (
    listingId: string,
    workspaceId?: string,
    page = 1,
    limit = 20
  ): Promise<AgentReviewListDTO> => {
    const response = await apiClient.get<{ data: AgentReviewListDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}/reviews`,
      { ...(workspaceConfig(workspaceId) ?? {}), params: { page, limit } }
    );
    return response.data.data;
  },

  getStats: async (listingId: string, workspaceId?: string): Promise<AgentMarketplaceStatsDTO> => {
    const response = await apiClient.get<{ data: AgentMarketplaceStatsDTO }>(
      `/api/v1/agent-marketplace/agents/${listingId}/stats`,
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getAnalytics: async (workspaceId?: string, timeframe = '30d'): Promise<MarketplaceAnalyticsDTO> => {
    const response = await apiClient.get<{ data: MarketplaceAnalyticsDTO }>(
      '/api/v1/agent-marketplace/analytics',
      { ...(workspaceConfig(workspaceId) ?? {}), params: { timeframe } }
    );
    return response.data.data;
  },

  getHealth: async (
    workspaceId?: string,
    listingId?: string
  ): Promise<AgentHealthResponseDTO> => {
    const response = await apiClient.get<{ data: AgentHealthResponseDTO }>(
      '/api/v1/agent-marketplace/health',
      { ...(workspaceConfig(workspaceId) ?? {}), params: listingId ? { listingId } : {} }
    );
    return response.data.data;
  },

  getRecommendations: async (
    workspaceId?: string,
    limit = 5
  ): Promise<MarketplaceRecommendationsDTO> => {
    const response = await apiClient.get<{ data: MarketplaceRecommendationsDTO }>(
      '/api/v1/agent-marketplace/recommendations',
      { ...(workspaceConfig(workspaceId) ?? {}), params: { limit } }
    );
    return response.data.data;
  },

  getLifecycle: async (workspaceId?: string): Promise<MarketplaceLifecycleDTO> => {
    const response = await apiClient.get<{ data: MarketplaceLifecycleDTO }>(
      '/api/v1/agent-marketplace/lifecycle',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};

export default agentMarketplaceApi;
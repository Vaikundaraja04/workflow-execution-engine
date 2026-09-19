import axios from 'axios';
import type {
  OverviewAnalyticsData,
  WorkflowAnalyticsData,
  ExecutionAnalyticsData,
  UserAnalyticsData,
  PerformanceAnalyticsData,
  CostAnalyticsData,
  SystemObservabilityHealth,
  SystemMetricsData,
  SecurityIntelligenceData,
  AIOperationsFailureExplanation,
  AIOperationsSystemSummary,
  AIOperationsOptimizationSuggestion,
  ReportItem,
  CreateReportInput,
} from '@/types/operations.types';

// Base URL for the operations API
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

export const operationsApi = {
  // Analytics endpoints
  getOverviewAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<OverviewAnalyticsData> => {
    const { data } = await axios.get(`${API_BASE_URL}/analytics/overview`, {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getWorkflowAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<WorkflowAnalyticsData> => {
    const { data } = await axios.get(`${API_BASE_URL}/analytics/workflows`, {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getExecutionAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<ExecutionAnalyticsData> => {
    const { data } = await axios.get(`${API_BASE_URL}/analytics/executions`, {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getUserAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<UserAnalyticsData> => {
    const { data } = await axios.get(`${API_BASE_URL}/analytics/users`, {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getPerformanceAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<PerformanceAnalyticsData> => {
    const { data } = await axios.get(`${API_BASE_URL}/analytics/performance`, {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getCostAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<CostAnalyticsData> => {
    const { data } = await axios.get(`${API_BASE_URL}/analytics/cost`, {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  exportAnalyticsData: async (
    workspaceId: string,
    type: string,
    format: 'json' | 'csv' = 'json'
  ): Promise<{ data: Blob; filename: string }> => {
    const response = await axios.get(`${API_BASE_URL}/analytics/export`, {
      params: { workspaceId, type, format },
      responseType: 'blob',
    });

    const filename = response.headers['content-disposition']
      ?.split('filename=')[1]
      ?.replace(/"/g, '') || `analytics-${type}.${format}`;

    return {
      data: new Blob([response.data]),
      filename,
    };
  },

  // Operations endpoints
  getSystemHealth: async (): Promise<SystemObservabilityHealth> => {
    const { data } = await axios.get(`${API_BASE_URL}/operations/health`);
    return data;
  },

  getSystemMetrics: async (): Promise<SystemMetricsData> => {
    const { data } = await axios.get(`${API_BASE_URL}/operations/metrics`);
    return data;
  },

  getSystemStatus: async (): Promise<{
    status: string;
    uptimeSeconds: number;
    timestamp: string;
    environment: string;
    nodeVersion: string;
    services: SystemObservabilityHealth['services'];
    metrics: SystemMetricsData;
  }> => {
    const { data } = await axios.get(`${API_BASE_URL}/operations/system`);
    return data;
  },

  // Security Intelligence endpoints
  getSecurityIntelligence: async (workspaceId: string): Promise<SecurityIntelligenceData> => {
    const { data } = await axios.get(`${API_BASE_URL}/security/intelligence`, {
      params: { workspaceId },
    });
    return data;
  },

  scanSecurityIntelligence: async (
    workspaceId: string,
    userId: string
  ): Promise<SecurityIntelligenceData> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/security/intelligence/scan`,
      { workspaceId, userId }
    );
    return data;
  },

  // AI Operations Assistant endpoints
  explainWorkflowFailure: async (
    executionId: string,
    workspaceId: string,
    userId?: string
  ): Promise<AIOperationsFailureExplanation> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/ai/operations/explain-failure`,
      { executionId, workspaceId, userId }
    );
    return data;
  },

  summarizeSystemHealth: async (
    workspaceId: string,
    userId?: string
  ): Promise<AIOperationsSystemSummary> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/ai/operations/system-summary`,
      { workspaceId, userId }
    );
    return data;
  },

  detectSystemAnomalies: async (
    workspaceId: string
  ): Promise<{ anomalies: Array<{
    id: string;
    type: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    detectedAt: string;
    recommendation: string;
  }> }> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/ai/operations/anomalies`,
      { workspaceId }
    );
    return data;
  },

  recommendScalingActions: async (
    workspaceId: string
  ): Promise<{
    currentConcurrency: number;
    recommendedWorkers: number;
    estimatedThroughputGainPercent: number;
    reasoning: string;
    recommendations: string[];
  }> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/ai/operations/scaling-recommendations`,
      { workspaceId }
    );
    return data;
  },

  suggestOptimizations: async (
    workspaceId: string
  ): Promise<AIOperationsOptimizationSuggestion[]> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/ai/operations/suggest-optimizations`,
      { workspaceId }
    );
    return data;
  },

  // Report endpoints
  createReport: async (
    workspaceId: string,
    userId: string,
    input: CreateReportInput
  ): Promise<ReportItem> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/reports`,
      { ...input, workspaceId, userId }
    );
    return data;
  },

  getReports: async (
    workspaceId: string,
    filters: { type?: string; status?: string } = {}
  ): Promise<ReportItem[]> => {
    const { data } = await axios.get(`${API_BASE_URL}/reports`, {
      params: { workspaceId, ...filters },
    });
    return data;
  },

  getReportById: async (
    reportId: string,
    workspaceId: string
  ): Promise<ReportItem | null> => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/reports/${reportId}`, {
        params: { workspaceId },
      });
      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  deleteReport: async (
    reportId: string,
    workspaceId: string,
    userId: string
  ): Promise<boolean> => {
    await axios.delete(`${API_BASE_URL}/reports/${reportId}`, {
      data: { workspaceId, userId },
    });
    return true;
  },

  exportReport: async (
    reportId: string,
    workspaceId: string,
    formatOverride?: string
  ): Promise<{ data: Blob; filename: string }> => {
    const params: Record<string, any> = { workspaceId };
    if (formatOverride) params.formatOverride = formatOverride;

    const response = await axios.get(`${API_BASE_URL}/reports/${reportId}/export`, {
      params,
      responseType: 'blob',
    });

    const filename = response.headers['content-disposition']
      ?.split('filename=')[1]
      ?.replace(/"/g, '') || `report-${reportId}`;

    return {
      data: new Blob([response.data]),
      filename,
    };
  },
};

export default operationsApi;
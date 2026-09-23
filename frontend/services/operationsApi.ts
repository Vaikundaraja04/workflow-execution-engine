import axios from 'axios';
import { apiClient } from './apiClient';
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

// The reports API returns MongoDB `_id` (lean queries) rather than `id`,
// so normalize to guarantee `ReportItem.id` is always populated.
const normalizeReport = (report: ReportItem & { _id?: string }): ReportItem => ({
  ...report,
  id: report.id || report._id || '',
});

export const operationsApi = {
  // Analytics endpoints
  getOverviewAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<OverviewAnalyticsData> => {
    const { data } = await apiClient.get('/api/v1/analytics/overview', {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getWorkflowAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<WorkflowAnalyticsData> => {
    const { data } = await apiClient.get('/api/v1/analytics/workflows', {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getExecutionAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<ExecutionAnalyticsData> => {
    const { data } = await apiClient.get('/api/v1/analytics/executions', {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getUserAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<UserAnalyticsData> => {
    const { data } = await apiClient.get('/api/v1/analytics/users', {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getPerformanceAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<PerformanceAnalyticsData> => {
    const { data } = await apiClient.get('/api/v1/analytics/performance', {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  getCostAnalytics: async (workspaceId: string, timeframe = '30d'): Promise<CostAnalyticsData> => {
    const { data } = await apiClient.get('/api/v1/analytics/cost', {
      params: { workspaceId, timeframe },
    });
    return data;
  },

  exportAnalyticsData: async (
    workspaceId: string,
    type: string,
    format: 'json' | 'csv' = 'json'
  ): Promise<{ data: Blob; filename: string }> => {
    const response = await apiClient.get('/api/v1/analytics/export', {
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
    const { data } = await apiClient.get('/api/v1/operations/health');
    return data;
  },

  getSystemMetrics: async (): Promise<SystemMetricsData> => {
    const { data } = await apiClient.get('/api/v1/operations/metrics');
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
    const { data } = await apiClient.get('/api/v1/operations/system');
    return data;
  },

  // Security Intelligence endpoints
  getSecurityIntelligence: async (workspaceId: string): Promise<SecurityIntelligenceData> => {
    const { data } = await apiClient.get('/api/v1/security/intelligence', {
      params: { workspaceId },
    });
    return data;
  },

  scanSecurityIntelligence: async (
    workspaceId: string,
    userId: string
  ): Promise<SecurityIntelligenceData> => {
    const { data } = await apiClient.post(
      '/api/v1/security/intelligence/scan',
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
    const { data } = await apiClient.post(
      '/api/v1/ai/operations/explain-failure',
      { executionId, workspaceId, userId }
    );
    return data;
  },
  summarizeSystemHealth: async (
    workspaceId: string,
    userId?: string
  ): Promise<AIOperationsSystemSummary> => {
    const { data } = await apiClient.post(
      '/api/v1/ai/operations/system-summary',
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
    const { data } = await apiClient.post(
      '/api/v1/ai/operations/anomalies',
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
    const { data } = await apiClient.post(
      '/api/v1/ai/operations/scaling-recommendations',
      { workspaceId }
    );
    return data;
  },

  suggestOptimizations: async (
    workspaceId: string
  ): Promise<AIOperationsOptimizationSuggestion[]> => {
    const { data } = await apiClient.post(
      '/api/v1/ai/operations/suggest-optimizations',
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
    const { data } = await apiClient.post(
      '/api/v1/reports',
      { ...input, workspaceId, userId }
    );
    return normalizeReport(data);
  },

  getReports: async (
    workspaceId: string,
    filters: { type?: string; status?: string } = {}
  ): Promise<ReportItem[]> => {
    const { data } = await apiClient.get('/api/v1/reports', {
      params: { workspaceId, ...filters },
    });
    return (data.reports as Array<ReportItem & { _id?: string }>).map(normalizeReport);
  },

  getReportById: async (
    reportId: string,
    workspaceId: string
  ): Promise<ReportItem | null> => {
    try {
      const { data } = await apiClient.get(`/api/v1/reports/${reportId}`, {
        params: { workspaceId },
      });
      return normalizeReport(data);
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
    await apiClient.delete(`/api/v1/reports/${reportId}`, {
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

    const response = await apiClient.get(`/api/v1/reports/${reportId}/export`, {
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


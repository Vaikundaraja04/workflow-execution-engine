import { apiClient } from './apiClient';
import type {
  SecurityAuditReportDTO,
  PerformanceBenchmarkReportDTO,
  IndexVerificationReportDTO,
  DisasterRecoveryReadinessDTO,
  DeploymentValidationReportDTO,
  EnterpriseMetricsReportDTO,
  ReadinessReportDTO,
} from '@/types/releaseReadiness';
import type {
  LiveMetricsDTO,
  MetricsHistoryDTO,
  ReadinessScanDTO,
  ProductionAlertDTO,
  MetricResolutionDTO,
  ProductionAlertStatusDTO,
  ProductionAlertTypeDTO,
} from '@/types/continuousMonitoring';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

/**
 * Phase 12.9 - Enterprise Release Readiness API client.
 * Backend routes are mounted under /api/v1/release-readiness and wrap all
 * payloads in a { data } envelope.
 */
export const releaseReadinessApi = {
  getSecurityAudit: async (workspaceId?: string): Promise<SecurityAuditReportDTO> => {
    const response = await apiClient.get<{ data: SecurityAuditReportDTO }>(
      '/api/v1/release-readiness/security-audit',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getPerformance: async (workspaceId?: string): Promise<PerformanceBenchmarkReportDTO> => {
    const response = await apiClient.get<{ data: PerformanceBenchmarkReportDTO }>(
      '/api/v1/release-readiness/performance',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getDatabase: async (workspaceId?: string): Promise<IndexVerificationReportDTO> => {
    const response = await apiClient.get<{ data: IndexVerificationReportDTO }>(
      '/api/v1/release-readiness/database',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
  getDisasterRecovery: async (workspaceId?: string): Promise<DisasterRecoveryReadinessDTO> => {
    const response = await apiClient.get<{ data: DisasterRecoveryReadinessDTO }>(
      '/api/v1/release-readiness/disaster-recovery',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getDeployment: async (workspaceId?: string): Promise<DeploymentValidationReportDTO> => {
    const response = await apiClient.get<{ data: DeploymentValidationReportDTO }>(
      '/api/v1/release-readiness/deployment',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getMetrics: async (workspaceId?: string, windowHours?: number): Promise<EnterpriseMetricsReportDTO> => {
    const response = await apiClient.get<{ data: EnterpriseMetricsReportDTO }>(
      '/api/v1/release-readiness/metrics',
      { ...(workspaceConfig(workspaceId) ?? {}), params: windowHours ? { windowHours } : {} }
    );
    return response.data.data;
  },

  getReadiness: async (workspaceId?: string): Promise<ReadinessReportDTO> => {
    const response = await apiClient.get<{ data: ReadinessReportDTO }>(
      '/api/v1/release-readiness/readiness',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getLiveMetrics: async (workspaceId?: string): Promise<LiveMetricsDTO> => {
    const response = await apiClient.get<{ data: LiveMetricsDTO }>(
      '/api/v1/release-readiness/live',
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getMetricsHistory: async (
    workspaceId?: string,
    params?: { resolution?: MetricResolutionDTO; hours?: number }
  ): Promise<MetricsHistoryDTO> => {
    const response = await apiClient.get<{ data: MetricsHistoryDTO }>(
      '/api/v1/release-readiness/metrics-history',
      { ...(workspaceConfig(workspaceId) ?? {}), params: params ?? {} }
    );
    return response.data.data;
  },

  getScanHistory: async (workspaceId?: string, limit?: number): Promise<ReadinessScanDTO[]> => {
    const response = await apiClient.get<{ data: { scans: ReadinessScanDTO[] } }>(
      '/api/v1/release-readiness/history',
      { ...(workspaceConfig(workspaceId) ?? {}), params: limit ? { limit } : {} }
    );
    return response.data.data.scans;
  },

  runReadinessScan: async (workspaceId?: string): Promise<ReadinessScanDTO> => {
    const response = await apiClient.post<{ data: ReadinessScanDTO }>(
      '/api/v1/release-readiness/scan',
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },

  getAlerts: async (
    workspaceId?: string,
    params?: { status?: ProductionAlertStatusDTO; type?: ProductionAlertTypeDTO; limit?: number }
  ): Promise<ProductionAlertDTO[]> => {
    const response = await apiClient.get<{ data: { alerts: ProductionAlertDTO[] } }>(
      '/api/v1/release-readiness/alerts',
      { ...(workspaceConfig(workspaceId) ?? {}), params: params ?? {} }
    );
    return response.data.data.alerts;
  },

  acknowledgeAlert: async (alertId: string, workspaceId?: string): Promise<ProductionAlertDTO> => {
    const response = await apiClient.post<{ data: ProductionAlertDTO }>(
      `/api/v1/release-readiness/alerts/${alertId}/acknowledge`,
      {},
      workspaceConfig(workspaceId)
    );
    return response.data.data;
  },
};

export default releaseReadinessApi;

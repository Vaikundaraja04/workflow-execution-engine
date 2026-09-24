import { apiClient } from './apiClient';
import type {
  SecurityDashboardData,
  SecurityEvent,
  RiskScoreData,
  SessionData,
  PrivacyRequest,
  PrivacyPreferences,
  SecretMetadata,
  WorkspaceSecurityPolicy,
  ComplianceFramework,
  ComplianceReportData,
} from '../types/security.types';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

export const securityApi = {
  // Security Dashboard
  getSecurityDashboard: async (workspaceId?: string): Promise<SecurityDashboardData> => {
    const response = await apiClient.get('/api/v1/security/dashboard', workspaceConfig(workspaceId));
    return response.data;
  },

  // Security Events
  getSecurityEvents: async (
    filters: {
      eventType?: string;
      severity?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    } = {},
    pagination: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{
    events: SecurityEvent[];
    total: number;
    limit: number;
    offset: number;
  }> => {
    const response = await apiClient.get('/api/v1/security/events', {
      params: { ...filters, ...pagination },
    });
    return response.data;
  },

  // Risk Score
  getRiskScore: async (): Promise<RiskScoreData> => {
    const response = await apiClient.get('/api/v1/security/risk-score');
    return response.data;
  },

  // Security Event Resolution
  resolveSecurityEvent: async (
    eventId: string,
    resolutionNotes: string,
    status: 'RESOLVED' | 'FALSE_POSITIVE'
  ): Promise<SecurityEvent> => {
    const response = await apiClient.post(`/api/v1/security/events/${eventId}/resolve`, {
      resolutionNotes,
      status,
    });
    return response.data;
  },

  // Session Management
  getUserSessions: async (): Promise<SessionData[]> => {
    const response = await apiClient.get('/api/v1/sessions');
    return response.data;
  },

  revokeSession: async (sessionId: string, reason?: string): Promise<void> => {
    await apiClient.post(`/api/v1/sessions/${sessionId}/revoke`, { reason });
  },

  revokeOtherSessions: async (): Promise<{ count: number }> => {
    const response = await apiClient.post('/api/v1/sessions/revoke-others');
    return response.data;
  },

  // Security Policy
  getSecurityPolicy: async (): Promise<WorkspaceSecurityPolicy> => {
    const response = await apiClient.get('/api/v1/sessions/policy');
    return response.data;
  },

  updateSecurityPolicy: async (
    policyData: Partial<WorkspaceSecurityPolicy>
  ): Promise<WorkspaceSecurityPolicy> => {
    const response = await apiClient.put('/api/v1/sessions/policy', policyData);
    return response.data;
  },

  // MFA Setup (served by the sessions router)
  setupMfa: async () => {
    const response = await apiClient.post('/api/v1/sessions/mfa/setup');
    return response.data;
  },

  verifyMfa: async (secret: string, token: string): Promise<{ verified: boolean }> => {
    const response = await apiClient.post('/api/v1/sessions/mfa/verify', { secret, token });
    return response.data;
  },

  // Secrets Management
  listSecrets: async (
    environment?: 'development' | 'staging' | 'production'
  ): Promise<SecretMetadata[]> => {
    const params = environment ? { environment } : {};
    const response = await apiClient.get('/api/v1/secrets', { params });
    return response.data;
  },

  createSecret: async (
    name: string,
    environment: 'development' | 'staging' | 'production',
    value: string
  ): Promise<SecretMetadata> => {
    const response = await apiClient.post('/api/v1/secrets', {
      name,
      environment,
      value,
    });
    return response.data;
  },

  getSecretValue: async (secretId: string): Promise<{
    metadata: SecretMetadata;
    value: string;
  }> => {
    const response = await apiClient.get(`/api/v1/secrets/${secretId}`);
    return response.data;
  },

  rotateSecret: async (
    secretId: string,
    value: string
  ): Promise<SecretMetadata> => {
    const response = await apiClient.post(`/api/v1/secrets/${secretId}/rotate`, { value });
    return response.data;
  },

  deleteSecret: async (secretId: string): Promise<{ success: boolean }> => {
    const response = await apiClient.delete(`/api/v1/secrets/${secretId}`);
    return response.data;
  },

  // Privacy & Compliance
  requestDataExport: async (): Promise<PrivacyRequest> => {
    const response = await apiClient.post('/api/v1/privacy/export');
    return response.data;
  },

  requestUserDeletion: async (immediate: boolean = false): Promise<PrivacyRequest> => {
    const response = await apiClient.post('/api/v1/privacy/delete-request', { immediate });
    return response.data;
  },

  getPrivacyRequests: async (): Promise<PrivacyRequest[]> => {
    const response = await apiClient.get('/api/v1/privacy/status');
    return response.data;
  },

  getPrivacyPreferences: async (): Promise<PrivacyPreferences> => {
    const response = await apiClient.get('/api/v1/privacy/preferences');
    return response.data;
  },

  updatePrivacyPreferences: async (
    preferences: Partial<PrivacyPreferences>
  ): Promise<PrivacyPreferences> => {
    const response = await apiClient.put('/api/v1/privacy/preferences', preferences);
    return response.data;
  },

  // Compliance Reports
  // Note: reports are generated on demand by the backend. There is no separate
  // generate/export endpoint — fetch the report and export it client-side.
  getComplianceReport: async (framework: ComplianceFramework): Promise<ComplianceReportData> => {
    const response = await apiClient.get(`/api/v1/compliance/reports/${framework.toLowerCase()}`);
    return response.data;
  },

  // Audit Logs
  exportAuditLogs: async (
    format: 'CSV' | 'JSON' = 'JSON',
    filters?: {
      action?: string;
      userId?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<{ data: string; filename: string; mimeType: string }> => {
    const params = {
      format,
      ...filters,
    };
    const response = await apiClient.get('/api/v1/audit/export', {
      params,
      responseType: 'blob',
    });

    // Extract filename from content-disposition header
    const contentDisposition = response.headers['content-disposition'];
    const filenameMatch = contentDisposition?.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = filenameMatch ? filenameMatch[1].replace(/['"]/g, '') : `audit-log.${format.toLowerCase()}`;

    const contentType = response.headers['content-type'];
    const mimeType = Array.isArray(contentType) ? contentType[0] : (contentType ? String(contentType) : 'application/octet-stream');

    return {
      data: await response.data.text(),
      filename,
      mimeType,
    };
  },

  verifyAuditChain: async (): Promise<{
    valid: boolean;
    totalChecked: number;
    brokenAtLogId?: string;
    reason?: string;
  }> => {
    const response = await apiClient.get('/api/v1/audit/verify-chain');
    return response.data;
  },
};

export default securityApi;

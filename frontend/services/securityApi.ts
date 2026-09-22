import axios from 'axios';
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

// Create axios instance with base URL and interceptors
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
  withCredentials: true,
});

// Request interceptor to attach auth token
apiClient.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

export const securityApi = {
  // Security Dashboard
  getSecurityDashboard: async (workspaceId?: string): Promise<SecurityDashboardData> => {
    const response = await apiClient.get('/security/dashboard', workspaceConfig(workspaceId));
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
    const response = await apiClient.get('/security/events', {
      params: { ...filters, ...pagination },
    });
    return response.data;
  },

  // Risk Score
  getRiskScore: async (): Promise<RiskScoreData> => {
    const response = await apiClient.get('/security/risk-score');
    return response.data;
  },

  // Security Event Resolution
  resolveSecurityEvent: async (
    eventId: string,
    resolutionNotes: string,
    status: 'RESOLVED' | 'FALSE_POSITIVE'
  ): Promise<SecurityEvent> => {
    const response = await apiClient.post(`/security/events/${eventId}/resolve`, {
      resolutionNotes,
      status,
    });
    return response.data;
  },

  // Session Management
  getUserSessions: async (): Promise<SessionData[]> => {
    const response = await apiClient.get('/sessions');
    return response.data;
  },

  revokeSession: async (sessionId: string, reason?: string): Promise<void> => {
    await apiClient.post(`/sessions/${sessionId}/revoke`, { reason });
  },

  revokeOtherSessions: async (): Promise<{ count: number }> => {
    const response = await apiClient.post('/sessions/revoke-others');
    return response.data;
  },

  // Security Policy
  getSecurityPolicy: async (): Promise<WorkspaceSecurityPolicy> => {
    const response = await apiClient.get('/sessions/policy');
    return response.data;
  },

  updateSecurityPolicy: async (
    policyData: Partial<WorkspaceSecurityPolicy>
  ): Promise<WorkspaceSecurityPolicy> => {
    const response = await apiClient.put('/sessions/policy', policyData);
    return response.data;
  },

  // MFA Setup
  setupMfa: async () => {
    const response = await apiClient.post('/auth/mfa/setup');
    return response.data;
  },

  verifyMfa: async (secret: string, token: string): Promise<{ verified: boolean }> => {
    const response = await apiClient.post('/auth/mfa/verify', { secret, token });
    return response.data;
  },

  // Secrets Management
  listSecrets: async (
    environment?: 'development' | 'staging' | 'production'
  ): Promise<SecretMetadata[]> => {
    const params = environment ? { environment } : {};
    const response = await apiClient.get('/secrets', { params });
    return response.data;
  },

  createSecret: async (
    name: string,
    environment: 'development' | 'staging' | 'production',
    value: string
  ): Promise<SecretMetadata> => {
    const response = await apiClient.post('/secrets', {
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
    const response = await apiClient.get(`/secrets/${secretId}`);
    return response.data;
  },

  rotateSecret: async (
    secretId: string,
    value: string
  ): Promise<SecretMetadata> => {
    const response = await apiClient.post(`/secrets/${secretId}/rotate`, { value });
    return response.data;
  },

  deleteSecret: async (secretId: string): Promise<{ success: boolean }> => {
    const response = await apiClient.delete(`/secrets/${secretId}`);
    return response.data;
  },

  // Privacy & Compliance
  requestDataExport: async (): Promise<PrivacyRequest> => {
    const response = await apiClient.post('/privacy/export');
    return response.data;
  },

  requestUserDeletion: async (immediate: boolean = false): Promise<PrivacyRequest> => {
    const response = await apiClient.post('/privacy/delete-request', { immediate });
    return response.data;
  },

  getPrivacyRequests: async (): Promise<PrivacyRequest[]> => {
    const response = await apiClient.get('/privacy/status');
    return response.data;
  },

  getPrivacyPreferences: async (): Promise<PrivacyPreferences> => {
    const response = await apiClient.get('/privacy/preferences');
    return response.data;
  },

  updatePrivacyPreferences: async (
    preferences: Partial<PrivacyPreferences>
  ): Promise<PrivacyPreferences> => {
    const response = await apiClient.put('/privacy/preferences', preferences);
    return response.data;
  },

  // Compliance Reports
  getComplianceReport: async (framework: ComplianceFramework): Promise<ComplianceReportData> => {
    const response = await apiClient.get(`/compliance/reports/${framework.toLowerCase()}`);
    return response.data;
  },

  generateComplianceReport: async (framework: ComplianceFramework): Promise<ComplianceReportData> => {
    const response = await apiClient.post(`/compliance/reports/${framework.toLowerCase()}/generate`);
    return response.data;
  },

  exportComplianceReport: async (
    reportId: string,
    format: 'PDF' | 'JSON'
  ): Promise<{ data: BlobPart; filename: string; mimeType: string }> => {
    const response = await apiClient.get(`/compliance/reports/${reportId}/export/${format.toLowerCase()}`, {
      responseType: 'blob'
    });

    // Extract filename from content-disposition header
    const contentDisposition = response.headers['content-disposition'];
    const filenameMatch = contentDisposition?.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = filenameMatch ? filenameMatch[1].replace(/['"]/g, '') : `compliance-report.${format.toLowerCase()}`;

    const contentType = response.headers['content-type'];
    const mimeType = Array.isArray(contentType) ? contentType[0] : (contentType ? String(contentType) : 'application/octet-stream');

    return {
      data: await response.data.text(),
      filename,
      mimeType,
    };
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
    const response = await apiClient.get('/audit/export', {
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
    isValid: boolean;
    breaks: Array<{ index: number; message: string }>;
    totalRecords: number;
  }> => {
    const response = await apiClient.get('/audit/verify-chain');
    return response.data;
  },
};

export default securityApi;
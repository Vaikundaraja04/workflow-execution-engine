import { apiClient } from './apiClient';
import type {
  AccountDTO,
  CatalogPlanDTO,
  CustomerDetailDTO,
  CustomerListDTO,
  InvoiceDTO,
  PlanIdDTO,
  UsageHistoryDTO,
  UsageSummaryDTO,
} from '@/types/saas';

function workspaceConfig(workspaceId?: string) {
  return workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
}

export interface CustomerListParams {
  status?: string;
  plan?: string;
  demo?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Phase 13 - Commercial SaaS API client.
 * Covers the customer console, usage metering and the internal customer
 * administration console.
 */
export const customerApi = {
  getAccount: async (workspaceId?: string): Promise<AccountDTO> => {
    const response = await apiClient.get<AccountDTO>('/api/v1/saas/account', workspaceConfig(workspaceId));
    return response.data;
  },
  recordOnboarding: async (
    input: { steps?: string[]; completed?: boolean },
    workspaceId?: string,
  ): Promise<{ steps: string[]; completed: boolean; completedAt: string | null }> => {
    const response = await apiClient.post('/api/v1/saas/onboarding', input, workspaceConfig(workspaceId));
    return response.data;
  },

  getUsage: async (workspaceId?: string): Promise<UsageSummaryDTO> => {
    const response = await apiClient.get<UsageSummaryDTO>('/api/v1/usage', workspaceConfig(workspaceId));
    return response.data;
  },

  getUsageHistory: async (days: number = 30, workspaceId?: string): Promise<UsageHistoryDTO> => {
    const response = await apiClient.get<UsageHistoryDTO>('/api/v1/usage/history', {
      ...(workspaceConfig(workspaceId) ?? {}),
      params: { days },
    });
    return response.data;
  },

  getInvoices: async (limit: number = 12, workspaceId?: string): Promise<InvoiceDTO[]> => {
    const response = await apiClient.get<{ invoices: InvoiceDTO[] }>('/api/v1/billing/invoices', {
      ...(workspaceConfig(workspaceId) ?? {}),
      params: { limit },
    });
    return response.data.invoices;
  },
  getPlans: async (): Promise<{ plans: CatalogPlanDTO[]; aliases: Record<string, string> }> => {
    const response = await apiClient.get<{ plans: CatalogPlanDTO[]; aliases: Record<string, string> }>(
      '/api/v1/billing/plans',
    );
    return response.data;
  },

  changePlan: async (plan: PlanIdDTO, workspaceId?: string): Promise<{ message: string }> => {
    const response = await apiClient.post('/api/v1/billing/upgrade', { plan }, workspaceConfig(workspaceId));
    return response.data;
  },

  startTrial: async (days: number, workspaceId?: string): Promise<{ message: string }> => {
    const response = await apiClient.post('/api/v1/billing/trial', { days }, workspaceConfig(workspaceId));
    return response.data;
  },

  cancelSubscription: async (immediate: boolean, workspaceId?: string): Promise<{ message: string }> => {
    const response = await apiClient.post(
      '/api/v1/billing/cancel',
      { immediate },
      workspaceConfig(workspaceId),
    );
    return response.data;
  },
  listCustomers: async (params: CustomerListParams = {}): Promise<CustomerListDTO> => {
    const response = await apiClient.get<CustomerListDTO>('/api/v1/saas/customers', { params });
    return response.data;
  },

  getCustomer: async (workspaceId: string): Promise<CustomerDetailDTO> => {
    const response = await apiClient.get<CustomerDetailDTO>(`/api/v1/saas/customers/${workspaceId}`);
    return response.data;
  },

  suspendCustomer: async (workspaceId: string): Promise<{ status: string }> => {
    const response = await apiClient.post(`/api/v1/saas/customers/${workspaceId}/suspend`, {});
    return response.data;
  },

  reactivateCustomer: async (workspaceId: string): Promise<{ status: string }> => {
    const response = await apiClient.post(`/api/v1/saas/customers/${workspaceId}/reactivate`, {});
    return response.data;
  },

  addCustomerNote: async (
    workspaceId: string,
    note: string,
  ): Promise<{ note: string; createdAt: string }> => {
    const response = await apiClient.post(`/api/v1/saas/customers/${workspaceId}/notes`, { note });
    return response.data;
  },
};

export default customerApi;

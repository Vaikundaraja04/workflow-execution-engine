import { apiClient } from './apiClient';

/**
 * Phase 18 - Enterprise operations client.
 *
 * Backs /enterprise/console with the account register (18.1), the success
 * intelligence (18.2) and the support desk (18.3), and /compliance with the
 * posture report (18.5). Every figure is reported by the backend from recorded
 * evidence - the client never recomputes a score.
 */

export type EnterpriseCustomerStatusDTO = 'TRIAL' | 'ACTIVE' | 'AT_RISK' | 'SUSPENDED' | 'CHURNED';
export type ContractTypeDTO = 'MONTHLY' | 'ANNUAL' | 'MULTI_YEAR' | 'CUSTOM';
export type ComplianceSectionStatusDTO = 'OK' | 'WARN' | 'UNKNOWN';
export type SupportTicketStatusDTO = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED';
export type SupportTicketPriorityDTO = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type SuccessIntelligenceStatusDTO = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface EnterpriseAccountDTO {
  accountId: string;
  workspaceId: string;
  workspaceName: string | null;
  company: string;
  industry: string | null;
  accountOwnerId: string;
  contractType: ContractTypeDTO;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  renewalDate: string | null;
  renewalDueInDays: number | null;
  customerStatus: EnterpriseCustomerStatusDTO;
  mrr: number | null;
  seats: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRegisterDTO {
  items: EnterpriseAccountDTO[];
  summary: {
    total: number;
    byStatus: Record<EnterpriseCustomerStatusDTO, number>;
    renewingSoon: number;
    mrrTotal: number;
  };
  page: number;
  limit: number;
  generatedAt: string;
}

export interface SuccessComponentDTO {
  key: string;
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export interface SuccessSignalsDTO {
  plan: string | null;
  tenantStatus: string | null;
  category: string;
  workflows: number;
  monthlyExecutions: number;
  totalExecutions: number;
  successRate: number;
  tokensThisMonth: number;
  tokenLimit: number | null;
  activeUsers: number;
  totalMembers: number;
  openTickets: number;
  breachedTickets: number;
  escalations: number;
}

export interface SuccessIntelligenceReportDTO {
  workspaceId: string;
  companyName: string;
  account: EnterpriseAccountDTO | null;
  status: SuccessIntelligenceStatusDTO;
  score: number;
  components: SuccessComponentDTO[];
  signals: SuccessSignalsDTO;
  risks: Array<{ code: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; message: string }>;
  recommendations: Array<{
    code: string;
    action: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    owner: 'CSM' | 'SUPPORT' | 'PLATFORM';
  }>;
  generatedAt: string;
}

export interface SupportTicketDTO {
  ticketId: string;
  ticketNumber: string;
  workspaceId: string;
  subject: string;
  description: string;
  category: string;
  priority: SupportTicketPriorityDTO;
  status: SupportTicketStatusDTO;
  createdBy: string;
  assigneeId: string | null;
  slaPolicyId: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  escalationLevel: number;
  breached: boolean;
  responded: boolean;
  overdue: boolean;
  overdueFirstResponse: boolean;
  ageHours: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketPageDTO {
  items: SupportTicketDTO[];
  summary: { total: number; open: number; breached: number; resolved: number };
  page: number;
  limit: number;
  total: number;
  generatedAt: string;
}

export interface ComplianceSectionDTO {
  key: string;
  label: string;
  weight: number;
  score: number;
  status: ComplianceSectionStatusDTO;
  findings: string[];
  evidence: Record<string, number>;
}

export interface ComplianceReportDTO {
  workspaceId: string | null;
  window: { days: number; since: string; until: string };
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  sections: ComplianceSectionDTO[];
  notes: string[];
  generatedAt: string;
}

export const enterpriseOperationsApi = {
  listAccounts: async (params: { limit?: number } = {}): Promise<AccountRegisterDTO> => {
    const response = await apiClient.get<{ data: AccountRegisterDTO }>('/api/v1/accounts', { params });
    return response.data.data;
  },
  getAccount: async (accountIdOrWorkspaceId: string): Promise<EnterpriseAccountDTO> => {
    const response = await apiClient.get<{ data: EnterpriseAccountDTO }>(
      `/api/v1/accounts/${accountIdOrWorkspaceId}`,
    );
    return response.data.data;
  },
  getCompanyHealth: async (workspaceId: string): Promise<SuccessIntelligenceReportDTO> => {
    const response = await apiClient.get<{ data: SuccessIntelligenceReportDTO }>(
      '/api/v1/customer-success/health',
      { params: { workspaceId } },
    );
    return response.data.data;
  },
  listTickets: async (
    params: { workspaceId?: string; status?: SupportTicketStatusDTO; breached?: boolean; limit?: number } = {},
  ): Promise<SupportTicketPageDTO> => {
    const response = await apiClient.get<{ data: SupportTicketPageDTO }>('/api/v1/support/tickets', { params });
    return response.data.data;
  },
  getComplianceCenter: async (params: { workspaceId?: string; days?: number } = {}): Promise<ComplianceReportDTO> => {
    const response = await apiClient.get<{ data: ComplianceReportDTO }>('/api/v1/compliance/center', { params });
    return response.data.data;
  },
};

export default enterpriseOperationsApi;

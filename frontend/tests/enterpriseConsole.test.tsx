import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnterpriseConsolePage from '@/app/(app)/enterprise/console/page';
import { enterpriseOperationsApi } from '@/services/enterpriseOperationsApi';
import { customerApi } from '@/services/customerApi';
import { securityApi } from '@/services/securityApi';
import { businessAnalyticsApi } from '@/services/businessAnalyticsApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { EnterpriseAccountDTO } from '@/services/enterpriseOperationsApi';
import type { SuccessIntelligenceReportDTO, SupportTicketPageDTO } from '@/services/enterpriseOperationsApi';
import type { UsageSummaryDTO } from '@/types/saas';
import type { SecurityDashboardData } from '@/types/security.types';

vi.mock('@/services/enterpriseOperationsApi', () => ({
  enterpriseOperationsApi: {
    getAccount: vi.fn(),
    getCompanyHealth: vi.fn(),
    listTickets: vi.fn(),
  },
}));
vi.mock('@/services/customerApi', () => ({
  customerApi: { getUsage: vi.fn() },
}));
vi.mock('@/services/securityApi', () => ({
  securityApi: { getSecurityDashboard: vi.fn() },
}));
vi.mock('@/services/businessAnalyticsApi', () => ({
  businessAnalyticsApi: { getReport: vi.fn() },
}));

const accountFixture: EnterpriseAccountDTO = {
  accountId: 'acc-1',
  workspaceId: 'ws-acme',
  workspaceName: 'Acme Workspace',
  company: 'Acme Robotics',
  industry: 'Manufacturing',
  accountOwnerId: 'user-owner',
  contractType: 'ANNUAL',
  subscriptionPlan: 'PROFESSIONAL',
  subscriptionStatus: 'ACTIVE',
  renewalDate: '2026-12-01T00:00:00.000Z',
  renewalDueInDays: 70,
  customerStatus: 'ACTIVE',
  mrr: 125000,
  seats: 25,
  notes: 'Strategic account',
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-09-20T09:30:00.000Z',
};

const usageFixture: UsageSummaryDTO = {
  workspaceId: 'ws-acme',
  plan: 'PROFESSIONAL',
  periodKey: '2026-09',
  metrics: [
    {
      metric: 'EXECUTIONS',
      value: 1200,
      limit: 5000,
      percent: 24,
      alertState: 'OK',
      overage: false,
      periodKey: '2026-09',
    },
  ],
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const healthFixture: SuccessIntelligenceReportDTO = {
  workspaceId: 'ws-acme',
  companyName: 'Acme Robotics',
  account: accountFixture,
  status: 'WARNING',
  score: 48,
  components: [
    { key: 'usage', label: 'Usage', weight: 25, score: 60, detail: '1200 executions in 30 days' },
  ],
  signals: {
    plan: 'PROFESSIONAL',
    tenantStatus: 'ACTIVE',
    category: 'WARNING',
    workflows: 12,
    monthlyExecutions: 1200,
    totalExecutions: 9000,
    successRate: 94,
    tokensThisMonth: 1000,
    tokenLimit: 50000,
    activeUsers: 8,
    totalMembers: 25,
    openTickets: 1,
    breachedTickets: 1,
    escalations: 1,
  },
  risks: [{ code: 'SUPPORT_PRESSURE', severity: 'MEDIUM', message: 'One breached ticket open' }],
  recommendations: [
    { code: 'REVIEW_SLA', action: 'Review the breached ticket', priority: 'HIGH', owner: 'SUPPORT' },
  ],
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const securityFixture: SecurityDashboardData = {
  riskScore: 35,
  riskCategory: 'MEDIUM',
  openThreatsCount: 1,
  totalEvents24h: 6,
  failedLogins24h: 2,
  activeSessionsCount: 4,
  recentEvents: [],
};

const ticketsFixture: SupportTicketPageDTO = {
  items: [
    {
      ticketId: 'ticket-1',
      ticketNumber: 'TCK-0001',
      workspaceId: 'ws-acme',
      subject: 'Execution failing on the billing workflow',
      description: 'The billing workflow stops on the payment node.',
      category: 'TECHNICAL',
      priority: 'HIGH',
      status: 'OPEN',
      createdBy: 'user-member',
      assigneeId: null,
      slaPolicyId: 'sla-high',
      firstResponseDueAt: '2026-09-22T14:00:00.000Z',
      resolutionDueAt: '2026-09-23T10:00:00.000Z',
      firstResponseAt: null,
      resolvedAt: null,
      resolution: null,
      escalationLevel: 1,
      breached: true,
      responded: false,
      overdue: true,
      overdueFirstResponse: true,
      ageHours: 12,
      tags: [],
      createdAt: '2026-09-22T02:00:00.000Z',
      updatedAt: '2026-09-22T08:00:00.000Z',
    },
  ],
  summary: { total: 3, open: 1, breached: 1, resolved: 2 },
  page: 1,
  limit: 10,
  total: 3,
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const billingFixture = {
  window: { since: '2026-08-23T00:00:00.000Z', until: '2026-09-22T00:00:00.000Z', days: 30 },
  acquisition: {
    visitors: 0,
    signups: 0,
    demos: 0,
    subscriptions: 0,
    visitToSignupPercent: 0,
    signupToSubscriptionPercent: 0,
    visitToSubscriptionPercent: 0,
    bySource: [],
  },
  revenue: {
    currency: 'usd',
    mrr: 125000,
    arr: 1500000,
    arpa: 25000,
    payingCustomers: 5,
    trialingCustomers: 2,
    planMix: [
      { packageId: 'professional', name: 'Professional', subscriptions: 5, mrr: 125000, sharePercent: 100 },
    ],
  },
  customers: {
    active: 5,
    newInWindow: 1,
    trialsEndingSoon: 1,
    churned: 0,
    startingBase: 4,
    churnRatePercent: 0,
  },
  health: { evaluated: 5, healthy: 3, watch: 1, atRisk: 1 },
  generatedAt: '2026-09-22T10:00:00.000Z',
};

describe('Phase 18.6 enterprise console', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useWorkspaceStore.setState({
      currentWorkspace: {
        _id: 'ws-acme',
        id: 'ws-acme',
        name: 'Acme Workspace',
        ownerId: 'user-owner',
        role: 'OWNER',
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
      },
      workspaces: [],
      currentRole: 'OWNER',
      isLoading: false,
      error: null,
    });
    vi.mocked(enterpriseOperationsApi.getAccount).mockResolvedValue(accountFixture);
    vi.mocked(enterpriseOperationsApi.getCompanyHealth).mockResolvedValue(healthFixture);
    vi.mocked(enterpriseOperationsApi.listTickets).mockResolvedValue(ticketsFixture);
    vi.mocked(customerApi.getUsage).mockResolvedValue(usageFixture);
    vi.mocked(securityApi.getSecurityDashboard).mockResolvedValue(securityFixture);
    vi.mocked(businessAnalyticsApi.getReport).mockResolvedValue(billingFixture);
  });

  it('renders every panel for the selected workspace', async () => {
    render(<EnterpriseConsolePage />);

    expect(await screen.findByText('Enterprise console')).toBeInTheDocument();
    expect(await screen.findByText('Account overview')).toBeInTheDocument();
    expect(screen.getByText('Acme Robotics · Acme Workspace')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('$15,000')).toBeInTheDocument();
    expect(screen.getAllByText('$1,250')).toHaveLength(3);

    expect(screen.getAllByText('Usage')).toHaveLength(2);
    expect(screen.getByText('1200')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();

    expect(screen.getByText('Customer health')).toBeInTheDocument();
    expect(screen.getByText('48 / 100')).toBeInTheDocument();
    expect(screen.getByText('WARNING')).toBeInTheDocument();
    expect(screen.getByText(/One breached ticket open/)).toBeInTheDocument();

    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('35 · MEDIUM')).toBeInTheDocument();

    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.getByText('TCK-0001')).toBeInTheDocument();
    expect(screen.getByText('Execution failing on the billing workflow')).toBeInTheDocument();

    expect(screen.getByText('Billing')).toBeInTheDocument();

    expect(enterpriseOperationsApi.getAccount).toHaveBeenCalledWith('ws-acme');
    expect(enterpriseOperationsApi.getCompanyHealth).toHaveBeenCalledWith('ws-acme');
    expect(enterpriseOperationsApi.listTickets).toHaveBeenCalledWith({ workspaceId: 'ws-acme', limit: 10 });
    expect(customerApi.getUsage).toHaveBeenCalledWith('ws-acme');
    expect(securityApi.getSecurityDashboard).toHaveBeenCalledWith('ws-acme');
    expect(businessAnalyticsApi.getReport).toHaveBeenCalledWith(30);
  });

  it('loads another workspace from the toolbar', async () => {
    render(<EnterpriseConsolePage />);
    await screen.findByText('Account overview');

    await userEvent.clear(screen.getByLabelText('Workspace'));
    await userEvent.type(screen.getByLabelText('Workspace'), 'ws-other');
    await userEvent.click(screen.getByRole('button', { name: 'Load workspace' }));

    await waitFor(() => {
      expect(enterpriseOperationsApi.getAccount).toHaveBeenCalledWith('ws-other');
    });
    expect(enterpriseOperationsApi.getCompanyHealth).toHaveBeenCalledWith('ws-other');
    expect(customerApi.getUsage).toHaveBeenCalledWith('ws-other');
    expect(securityApi.getSecurityDashboard).toHaveBeenCalledWith('ws-other');
    expect(enterpriseOperationsApi.listTickets).toHaveBeenCalledWith({ workspaceId: 'ws-other', limit: 10 });
  });

  it('asks for a workspace instead of guessing one', async () => {
    useWorkspaceStore.setState({ currentWorkspace: null, currentRole: null });

    render(<EnterpriseConsolePage />);

    expect(await screen.findByText('Enterprise console')).toBeInTheDocument();
    expect(await screen.findAllByText('No workspace selected')).toHaveLength(5);
    expect(enterpriseOperationsApi.getAccount).not.toHaveBeenCalled();
    expect(customerApi.getUsage).not.toHaveBeenCalled();
    expect(businessAnalyticsApi.getReport).toHaveBeenCalledWith(30);
  });

  it('surfaces panel failures independently', async () => {
    vi.mocked(enterpriseOperationsApi.getAccount).mockRejectedValue({
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Enterprise account was not found',
      status: 404,
    });
    vi.mocked(businessAnalyticsApi.getReport).mockRejectedValue({
      code: 'FORBIDDEN',
      message: 'Insufficient permission for this action',
      status: 403,
    });

    render(<EnterpriseConsolePage />);

    expect(await screen.findByText('No account recorded')).toBeInTheDocument();
    expect(await screen.findByText('Could not load billing analytics')).toBeInTheDocument();
    expect(screen.getByText('Insufficient permission for this action')).toBeInTheDocument();
    expect(await screen.findByText('Customer health')).toBeInTheDocument();
    expect(screen.getByText('TCK-0001')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerOverviewPage from '@/app/customer/page';
import CustomerSubscriptionPage from '@/app/customer/subscription/page';
import CustomerUsagePage from '@/app/customer/usage/page';
import AdminCustomersPage from '@/app/(app)/admin/customers/page';
import { customerApi } from '@/services/customerApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type {
  AccountDTO,
  CatalogPlanDTO,
  CustomerListDTO,
  UsageHistoryDTO,
  UsageSummaryDTO,
} from '@/types/saas';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/customer',
  useParams: () => ({ id: 'workspace-1' }),
  notFound: vi.fn(),
}));

vi.mock('@/services/customerApi', () => ({
  customerApi: {
    getAccount: vi.fn(),
    recordOnboarding: vi.fn(),
    getUsage: vi.fn(),
    getUsageHistory: vi.fn(),
    getInvoices: vi.fn(),
    getPlans: vi.fn(),
    changePlan: vi.fn(),
    startTrial: vi.fn(),
    cancelSubscription: vi.fn(),
    listCustomers: vi.fn(),
    getCustomer: vi.fn(),
    suspendCustomer: vi.fn(),
    reactivateCustomer: vi.fn(),
    addCustomerNote: vi.fn(),
  },
}));

const usageSummary: UsageSummaryDTO = {
  workspaceId: 'workspace-1',
  plan: 'PROFESSIONAL',
  periodKey: '2026-09',
  metrics: [
    { metric: 'EXECUTIONS', value: 4200, limit: 10000, percent: 42, alertState: 'OK', overage: false, periodKey: '2026-09' },
    { metric: 'AI_TOKENS', value: 91000, limit: 100000, percent: 91, alertState: 'WARNING', overage: false, periodKey: '2026-09' },
    { metric: 'AGENT_RUNS', value: 150, limit: 500, percent: 30, alertState: 'OK', overage: false, periodKey: '2026-09' },
    { metric: 'API_REQUESTS', value: 12000, limit: 10000, percent: 120, alertState: 'EXCEEDED', overage: true, periodKey: '2026-09' },
    { metric: 'STORAGE_BYTES', value: 2147483648, limit: 10737418240, percent: 20, alertState: 'OK', overage: false, periodKey: '2026-09' },
  ],
  generatedAt: '2026-09-21T00:00:00.000Z',
};

const accountFixture: AccountDTO = {
  tenant: {
    id: 'tenant-1',
    workspaceId: 'workspace-1',
    companyName: 'Acme Automation',
    status: 'ACTIVE',
    plan: 'PROFESSIONAL',
    region: 'ap-south-1',
    trialEndsAt: null,
    demo: false,
    useCase: 'Order processing',
    onboarding: {
      completed: true,
      steps: ['workspace-created', 'workflow-published'],
      startedAt: '2026-08-01T00:00:00.000Z',
      completedAt: '2026-08-02T00:00:00.000Z',
    },
  },
  profile: {
    contactName: 'Durai',
    contactEmail: 'billing@acme.test',
    contactPhone: '+91-90000-00000',
    company: 'Acme Automation',
    billingAddress: { line1: '1 Test Street', city: 'Chennai', country: 'IN' },
    taxId: 'GSTIN123',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  subscription: {
    id: 'subscription-1',
    plan: 'PROFESSIONAL',
    status: 'ACTIVE',
    billingProvider: 'mock',
    currentPeriodStart: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    trialEndsAt: null,
  },
  usage: usageSummary,
};

const plansFixture: CatalogPlanDTO[] = [
  {
    id: 'FREE',
    name: 'Free',
    description: 'Evaluate the engine.',
    priceMonthly: 0,
    currency: 'usd',
    limits: { workflows: 3, executionsPerMonth: 500, apiKeys: 1, webhooks: 1, members: 3, storageBytes: 1073741824 },
    features: ['Community support'],
  },
  {
    id: 'STARTER',
    name: 'Starter',
    description: 'For small teams.',
    priceMonthly: 2900,
    currency: 'usd',
    limits: { workflows: 10, executionsPerMonth: 5000, apiKeys: 3, webhooks: 3, members: 10, storageBytes: 10737418240 },
    features: ['Email support'],
  },
  {
    id: 'PROFESSIONAL',
    name: 'Professional',
    description: 'For growing operations.',
    priceMonthly: 9900,
    currency: 'usd',
    limits: { workflows: 50, executionsPerMonth: 50000, apiKeys: 10, webhooks: 10, members: 50, storageBytes: 107374182400 },
    features: ['Priority support'],
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'For platform teams.',
    priceMonthly: 49900,
    currency: 'usd',
    limits: { workflows: 500, executionsPerMonth: 500000, apiKeys: 50, webhooks: 50, members: 500, storageBytes: 1099511627776 },
    features: ['Dedicated support'],
  },
];

const historyFixture: UsageHistoryDTO = {
  workspaceId: 'workspace-1',
  days: 30,
  series: [
    {
      metric: 'EXECUTIONS',
      points: [
        { periodKey: '2026-09-19', value: 120 },
        { periodKey: '2026-09-20', value: 180 },
        { periodKey: '2026-09-21', value: 90 },
      ],
    },
  ],
};

const customersFixture: CustomerListDTO = {
  customers: [
    {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      companyName: 'Acme Automation',
      status: 'ACTIVE',
      workspaceStatus: 'ACTIVE',
      plan: 'PROFESSIONAL',
      region: 'ap-south-1',
      demo: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      subscription: {
        status: 'ACTIVE',
        billingProvider: 'mock',
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        trialEndsAt: null,
      },
      usage: {
        executionsThisMonth: 4200,
        storageBytes: 2147483648,
        warningMetrics: ['AI_TOKENS'],
        exceededMetrics: ['API_REQUESTS'],
      },
      health: { score: 82, band: 'healthy', factors: { subscription: 90, usagePressure: 70, activity: 85 } },
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

describe('Phase 13 customer console', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    useWorkspaceStore.setState({
      currentWorkspace: null,
      workspaces: [],
      currentRole: 'OWNER',
      isLoading: false,
      error: null,
    });

    vi.mocked(customerApi.getAccount).mockResolvedValue(accountFixture);
    vi.mocked(customerApi.getUsage).mockResolvedValue(usageSummary);
    vi.mocked(customerApi.getUsageHistory).mockResolvedValue(historyFixture);
    vi.mocked(customerApi.getPlans).mockResolvedValue({
      plans: plansFixture,
      aliases: { BUSINESS: 'PROFESSIONAL' },
    });
    vi.mocked(customerApi.getInvoices).mockResolvedValue([
      {
        id: 'in_001',
        customerId: 'cus_1',
        status: 'paid',
        amountDue: 9900,
        amountPaid: 9900,
        currency: 'usd',
        created: 1756684800,
        dueDate: 1759276800,
        paid: true,
      },
    ]);
    vi.mocked(customerApi.listCustomers).mockResolvedValue(customersFixture);
    vi.mocked(customerApi.changePlan).mockResolvedValue({ message: 'ok' });
  });

  it('renders the customer dashboard from the SaaS account API', async () => {
    render(<CustomerOverviewPage />);

    expect(await screen.findByRole('heading', { name: 'Acme Automation' })).toBeInTheDocument();
    expect(screen.getByText(/PROFESSIONAL plan via mock/)).toBeInTheDocument();
    expect(screen.getByText('Manage subscription')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /Executions usage/i })).toBeInTheDocument();
    expect(screen.getByText(/4,200 \/ 10,000/)).toBeInTheDocument();
  });

  it('shows a loading state while the account request is pending', () => {
    vi.mocked(customerApi.getAccount).mockReturnValue(new Promise(() => {}));

    render(<CustomerOverviewPage />);

    expect(screen.getByText('Loading your account...')).toBeInTheDocument();
  });

  it('shows the API error message and retries the request', async () => {
    vi.mocked(customerApi.getAccount).mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Tenant is suspended',
      status: 403,
    });

    render(<CustomerOverviewPage />);

    expect(await screen.findByText('Tenant is suspended')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(customerApi.getAccount).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByRole('heading', { name: 'Acme Automation' })).toBeInTheDocument();
  });

  it('displays subscription data from the billing service', async () => {
    render(<CustomerSubscriptionPage />);

    expect(await screen.findByRole('heading', { name: 'PROFESSIONAL plan' })).toBeInTheDocument();
    expect(screen.getByText(/Billing provider: mock/)).toBeInTheDocument();
    expect(screen.getByText('in_001')).toBeInTheDocument();
    expect(screen.getByText('99.00 USD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to STARTER/i })).toBeEnabled();
  });

  it('displays every metered metric on the usage dashboard', async () => {
    render(<CustomerUsagePage />);

    expect(await screen.findByRole('meter', { name: /Executions usage/i })).toBeInTheDocument();
    expect(screen.getByText('AI tokens')).toBeInTheDocument();
    expect(screen.getByText('Agent runs')).toBeInTheDocument();
    expect(screen.getByText('API requests')).toBeInTheDocument();
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText(/Overage/)).toBeInTheDocument();
    expect(await screen.findByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('peak 180')).toBeInTheDocument();
  });

  it('restricts billing controls for a role without WORKFLOW_CREATE', async () => {
    useWorkspaceStore.setState({ currentRole: 'VIEWER' });

    render(<CustomerSubscriptionPage />);

    expect(await screen.findAllByText(/read-only access to billing/i)).not.toHaveLength(0);

    const downgrade = screen.getByRole('button', { name: /switch to STARTER/i });
    expect(downgrade).toBeDisabled();
    expect(screen.getByRole('button', { name: /start free trial/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel subscription/i })).toBeDisabled();

    await userEvent.click(downgrade);
    expect(customerApi.changePlan).not.toHaveBeenCalled();
  });
});

describe('Phase 13 admin customer console', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    vi.mocked(customerApi.listCustomers).mockResolvedValue(customersFixture);
  });

  it('renders the customer table for an owner', async () => {
    useWorkspaceStore.setState({ currentRole: 'OWNER' });

    render(<AdminCustomersPage />);

    expect(await screen.findByRole('link', { name: 'Acme Automation' })).toBeInTheDocument();
    expect(screen.getByText('healthy · 82')).toBeInTheDocument();
    expect(screen.getByText('API_REQUESTS over')).toBeInTheDocument();
    expect(screen.getByText('AI_TOKENS high')).toBeInTheDocument();
    expect(screen.getByText(/1 customer\b/)).toBeInTheDocument();
  });

  it('blocks roles outside OWNER and ADMIN', () => {
    useWorkspaceStore.setState({ currentRole: 'EDITOR' });
    vi.mocked(customerApi.listCustomers).mockReturnValue(new Promise(() => {}));

    render(<AdminCustomersPage />);

    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Acme Automation' })).not.toBeInTheDocument();
  });
});

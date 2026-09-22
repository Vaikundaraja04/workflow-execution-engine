import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerBillingPage from '@/app/customer/billing/page';
import BusinessAnalyticsPage from '@/app/analytics/business/page';
import { customerApi } from '@/services/customerApi';
import { billingConsoleApi } from '@/services/billingConsoleApi';
import { businessAnalyticsApi } from '@/services/businessAnalyticsApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { AccountDTO, CatalogPlanDTO, UsageSummaryDTO } from '@/types/saas';
import type {
  CheckoutSessionDTO,
  CheckoutVerificationDTO,
  EntitlementSummaryDTO,
  PaymentRecordDTO,
} from '@/services/billingConsoleApi';
import type { BusinessAnalyticsReportDTO } from '@/services/businessAnalyticsApi';

vi.mock('@/services/customerApi', () => ({
  customerApi: {
    getAccount: vi.fn(),
    getPlans: vi.fn(),
    getInvoices: vi.fn(),
    getUsage: vi.fn(),
    getUsageHistory: vi.fn(),
    recordOnboarding: vi.fn(),
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

vi.mock('@/services/billingConsoleApi', () => ({
  billingConsoleApi: {
    createCheckoutSession: vi.fn(),
    verifyCheckout: vi.fn(),
    getPayments: vi.fn(),
    getEntitlements: vi.fn(),
  },
}));

vi.mock('@/services/businessAnalyticsApi', () => ({
  businessAnalyticsApi: { getReport: vi.fn() },
}));

const usageSummary: UsageSummaryDTO = {
  workspaceId: 'workspace-1',
  plan: 'PROFESSIONAL',
  periodKey: '2026-09',
  metrics: [
    { metric: 'EXECUTIONS', value: 4200, limit: 10000, percent: 42, alertState: 'OK', overage: false, periodKey: '2026-09' },
    { metric: 'AI_TOKENS', value: 91000, limit: 100000, percent: 91, alertState: 'WARNING', overage: false, periodKey: '2026-09' },
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
      steps: ['workspace-created'],
      startedAt: '2026-08-01T00:00:00.000Z',
      completedAt: '2026-08-02T00:00:00.000Z',
    },
  },
  profile: null,
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

const entitlementsFixture: EntitlementSummaryDTO = {
  workspaceId: 'workspace-1',
  plan: 'PROFESSIONAL',
  subscriptionStatus: 'ACTIVE',
  packageId: 'BUSINESS',
  packageName: 'Business',
  features: [
    { feature: 'WORKFLOWS', entitled: true, reason: 'PLAN', requiredPlan: 'STARTER' },
    { feature: 'ANALYTICS', entitled: true, reason: 'PLAN', requiredPlan: 'PROFESSIONAL' },
    { feature: 'SSO', entitled: false, reason: 'PLAN', requiredPlan: 'ENTERPRISE' },
  ],
  quotas: [
    { feature: 'EXECUTIONS', limit: 100000, used: 4200, remaining: 95800, percent: 4.2, exceeded: false },
    { feature: 'AI_REQUESTS', limit: 100000, used: 120000, remaining: -20000, percent: 120, exceeded: true },
  ],
  upgradeTargets: ['ENTERPRISE'],
  generatedAt: '2026-09-21T00:00:00.000Z',
};

const paymentsFixture: PaymentRecordDTO[] = [
  {
    _id: 'pay-1',
    provider: 'mock',
    paymentId: 'pay_mock_1',
    customerId: 'cus_1',
    packageId: 'BUSINESS',
    plan: 'PROFESSIONAL',
    amount: 9900,
    amountReceived: 9900,
    refundedAmount: 0,
    currency: 'usd',
    status: 'succeeded',
    method: 'card',
    paid: true,
    activated: true,
    providerCreatedAt: 1756684800,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

const sessionFixture: CheckoutSessionDTO = {
  id: 'cs_test_1',
  clientSecret: 'cs_secret',
  status: 'requires_confirmation',
  provider: 'mock',
  packageId: 'ENTERPRISE',
  plan: 'ENTERPRISE',
  amount: 49900,
  currency: 'usd',
  rails: ['card'],
};

const verificationFixture: CheckoutVerificationDTO = {
  activated: true,
  alreadyActive: true,
  reason: 'ACTIVATED',
  payment: {
    id: 'cs_test_1',
    customerId: 'cus_1',
    amount: 49900,
    amountReceived: 49900,
    refundedAmount: 0,
    currency: 'usd',
    status: 'succeeded',
    method: 'card',
    paid: true,
  },
  subscription: {
    plan: 'ENTERPRISE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    currentPeriodStart: '2026-09-22T00:00:00.000Z',
    currentPeriodEnd: '2026-10-22T00:00:00.000Z',
  },
  entitlements: entitlementsFixture,
};

const reportFixture: BusinessAnalyticsReportDTO = {
  window: { since: '2026-08-23T00:00:00.000Z', until: '2026-09-22T00:00:00.000Z', days: 30 },
  acquisition: {
    visitors: 1000,
    signups: 120,
    demos: 30,
    subscriptions: 12,
    visitToSignupPercent: 12,
    signupToSubscriptionPercent: 10,
    visitToSubscriptionPercent: 1.2,
    bySource: [{ source: 'WEBSITE', landing: 800, signups: 90, subscriptions: 8 }],
  },
  revenue: {
    currency: 'USD',
    mrr: 9900,
    arr: 118800,
    arpa: 825,
    payingCustomers: 12,
    trialingCustomers: 5,
    planMix: [
      { packageId: 'BUSINESS', name: 'Business', subscriptions: 12, mrr: 9900, sharePercent: 100 },
    ],
  },
  customers: {
    active: 12,
    newInWindow: 3,
    trialsEndingSoon: 2,
    churned: 1,
    startingBase: 10,
    churnRatePercent: 10,
  },
  health: { evaluated: 17, healthy: 12, watch: 3, atRisk: 2 },
  generatedAt: '2026-09-22T00:00:00.000Z',
};

describe('Phase 15.5 customer billing console', () => {
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
    vi.mocked(customerApi.getPlans).mockResolvedValue({
      plans: plansFixture,
      aliases: { BUSINESS: 'PROFESSIONAL' },
    });
    vi.mocked(customerApi.getInvoices).mockResolvedValue([]);
    vi.mocked(billingConsoleApi.getPayments).mockResolvedValue(paymentsFixture);
    vi.mocked(billingConsoleApi.getEntitlements).mockResolvedValue(entitlementsFixture);
    vi.mocked(billingConsoleApi.createCheckoutSession).mockResolvedValue(sessionFixture);
    vi.mocked(billingConsoleApi.verifyCheckout).mockResolvedValue(verificationFixture);
  });

  it('renders the billing console read models', async () => {
    render(<CustomerBillingPage />);

    expect(await screen.findByText('Billing console')).toBeInTheDocument();
    expect(await screen.findByText(/PROFESSIONAL plan via mock/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /executions usage/i })).toBeInTheDocument();
    expect(screen.getByText(/4,200 \/ 10,000/)).toBeInTheDocument();
    expect(screen.getByText(/Exceeded: ai requests/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Current plan' })).toBeDisabled();
    expect(screen.getByText('pay_mock_1')).toBeInTheDocument();
    expect(screen.getAllByText('$99').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 of 3 features entitled/)).toBeInTheDocument();
  });

  it('runs checkout through the provider and reports activation', async () => {
    render(<CustomerBillingPage />);

    const checkout = await screen.findByRole('button', { name: 'Checkout Enterprise' });
    await userEvent.click(checkout);

    await waitFor(() => {
      expect(billingConsoleApi.createCheckoutSession).toHaveBeenCalledWith({
        packageId: 'ENTERPRISE',
      });
    });
    expect(billingConsoleApi.verifyCheckout).toHaveBeenCalledWith({
      paymentId: 'cs_test_1',
      packageId: 'ENTERPRISE',
    });
    expect(await screen.findByText(/the workspace is now on ENTERPRISE/)).toBeInTheDocument();
  });

  it('disables checkout for a read-only role', async () => {
    useWorkspaceStore.setState({ currentRole: 'VIEWER' });

    render(<CustomerBillingPage />);

    const checkout = await screen.findByRole('button', { name: 'Checkout Enterprise' });
    expect(checkout).toBeDisabled();
    expect(screen.getByText(/read-only access to billing/i)).toBeInTheDocument();

    await userEvent.click(checkout);
    expect(billingConsoleApi.createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('Phase 15.8 business analytics dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(businessAnalyticsApi.getReport).mockResolvedValue(reportFixture);
  });

  it('renders the funnel, revenue, customers and plan mix', async () => {
    render(<BusinessAnalyticsPage />);

    expect(await screen.findByText('Business analytics')).toBeInTheDocument();
    expect(await screen.findByText('$99 MRR')).toBeInTheDocument();
    expect(screen.getByText(/Visitors: 1,000/)).toBeInTheDocument();
    expect(screen.getByText(/Subscriptions: 12/)).toBeInTheDocument();
    expect(screen.getByText(/Churned: 1 \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText(/At risk: 2 of 17 evaluated customers/)).toBeInTheDocument();
    expect(screen.getByText('WEBSITE')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('reloads the report when the window changes', async () => {
    render(<BusinessAnalyticsPage />);

    await screen.findByText('Business analytics');
    await waitFor(() => {
      expect(businessAnalyticsApi.getReport).toHaveBeenCalledWith(30);
    });

    await userEvent.selectOptions(screen.getByLabelText('Window'), 'Last 90 days');

    await waitFor(() => {
      expect(businessAnalyticsApi.getReport).toHaveBeenCalledWith(90);
    });
  });

  it('surfaces the administrator-only error from the endpoint', async () => {
    vi.mocked(businessAnalyticsApi.getReport).mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Platform administrators only',
      status: 403,
    });

    render(<BusinessAnalyticsPage />);

    expect(await screen.findByText('Platform administrators only')).toBeInTheDocument();
  });
});

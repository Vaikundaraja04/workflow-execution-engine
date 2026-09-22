import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PricingPage from '@/app/pricing/page';
import FeaturesPage from '@/app/features/page';
import SolutionsPage from '@/app/solutions/page';
import DemoPage from '@/app/demo/page';
import ContactSalesPage from '@/app/contact-sales/page';
import { marketingApi } from '@/services/marketingApi';
import type { MarketingPackaging, MarketingPlan } from '@/services/marketingApi';
import { useAuthStore } from '@/stores/authStore';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/pricing',
  useParams: () => ({}),
  notFound: vi.fn(),
}));

vi.mock('@/services/marketingApi', () => ({
  marketingApi: {
    getPlans: vi.fn(),
    comparePlans: vi.fn(),
    getSolutions: vi.fn(),
    captureLead: vi.fn(),
    createDemoWorkspace: vi.fn(),
  },
}));

const packaging: MarketingPackaging = {
  includedWorkflows: 50,
  executionLimit: 10000,
  aiRequestLimit: 100000,
  agentLimit: 3,
  storageBytes: 1073741824,
  seats: 10,
  supportLevel: 'EMAIL',
  supportResponseHours: 24,
  trialDays: 14,
};

function makePlan(
  id: MarketingPlan['id'],
  name: string,
  priceMonthly: number,
  highlights: string[],
  entitlements: string[] = ['WORKFLOWS', 'EXECUTIONS'],
): MarketingPlan {
  return {
    id,
    name,
    tagline: `${name} tagline`,
    description: `${name} description`,
    audience: 'Teams',
    internalPlan: id === 'BUSINESS' ? 'PROFESSIONAL' : id,
    priceMonthly,
    annualPriceMonthly: priceMonthly - 500,
    currency: 'USD',
    packaging,
    entitlements,
    highlights,
    addOns: [],
    sortOrder: 1,
  };
}

const starter = makePlan('STARTER', 'Starter', 2900, ['Up to 50 workflows', '10,000 executions / month']);
const business = makePlan('BUSINESS', 'Business', 9900, ['Up to 250 workflows', 'Advanced analytics'], [
  'WORKFLOWS',
  'EXECUTIONS',
  'ANALYTICS',
  'AUDIT_LOGS',
]);
const enterprise = makePlan('ENTERPRISE', 'Enterprise', 49900, ['Unlimited-scale workflows']);

const planCatalog = {
  plans: [starter, business, enterprise],
  freeTier: {
    packageId: null,
    name: 'Free',
    priceMonthly: 0,
    currency: 'USD',
    internalPlan: 'FREE' as const,
  },
  aliases: { BUSINESS: 'PROFESSIONAL' },
};

const comparisonFixture = {
  from: { packageId: 'STARTER' as const, name: 'Starter', priceMonthly: 2900, currency: 'USD' },
  to: { packageId: 'BUSINESS' as const, name: 'Business', priceMonthly: 9900, currency: 'USD' },
  priceDeltaPercent: 241.4,
  upgrade: true,
  limitDeltas: [
    { field: 'includedWorkflows' as const, from: 50, to: 250, delta: 200 },
    { field: 'agentLimit' as const, from: 3, to: 25, delta: 22 },
  ],
  entitlementsAdded: ['ANALYTICS', 'AUDIT_LOGS'],
  entitlementsRemoved: [],
  recommended: true,
};

const solutionsFixture = [
  {
    id: 'customer-support-automation',
    name: 'Customer support automation',
    industry: 'Technology',
    summary: 'Route and resolve support tickets.',
    outcomes: ['Faster first response'],
    recommendedPackage: 'BUSINESS' as const,
    tags: ['support'],
    workflowCount: 3,
    agentCount: 1,
  },
  {
    id: 'finance-approval-automation',
    name: 'Finance approval automation',
    industry: 'Financial Services',
    summary: 'Approve invoices with policy checks.',
    outcomes: ['Fewer manual approvals'],
    recommendedPackage: 'ENTERPRISE' as const,
    tags: ['finance'],
    workflowCount: 4,
    agentCount: 0,
  },
];

const demoFixture = {
  workspaceId: 'demo-workspace-1',
  tenantId: 'demo-tenant-1',
  ownerUserId: 'demo-owner-1',
  demoExpiresAt: '2026-09-25T00:00:00.000Z',
  workflowIds: ['wf-1', 'wf-2'],
  agentIds: ['agent-1'],
  tokens: { accessToken: 'demo-access', refreshToken: 'demo-refresh' },
};

describe('Phase 15.1 marketing site', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ isAuthenticated: false, accessToken: null, refreshToken: null });

    vi.mocked(marketingApi.getPlans).mockResolvedValue(planCatalog);
    vi.mocked(marketingApi.comparePlans).mockResolvedValue(comparisonFixture);
    vi.mocked(marketingApi.getSolutions).mockResolvedValue(solutionsFixture);
    vi.mocked(marketingApi.captureLead).mockResolvedValue({
      lead: {
        id: 'lead-1',
        company: 'Acme',
        contactName: 'Durai',
        contactEmail: 'durai@acme.test',
        source: 'DEMO_REQUEST',
        status: 'NEW',
        capturedAt: '2026-09-22T00:00:00.000Z',
      },
      duplicate: false,
    });
    vi.mocked(marketingApi.createDemoWorkspace).mockResolvedValue(demoFixture);
  });

  it('renders the live package catalog with register links', async () => {
    render(<PricingPage />);

    const catalog = await screen.findByRole('region', { name: 'Package catalog' });
    expect(within(catalog).getByText('Starter')).toBeInTheDocument();
    expect(within(catalog).getByText('Business')).toBeInTheDocument();
    expect(within(catalog).getByText('Enterprise')).toBeInTheDocument();
    expect(within(catalog).getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('$29')).toBeInTheDocument();
    expect(screen.getByText('$99')).toBeInTheDocument();
    expect(within(catalog).getByRole('link', { name: 'Start with Business' })).toHaveAttribute(
      'href',
      '/register?plan=BUSINESS',
    );
    expect(within(catalog).getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/register');
    expect(screen.queryByRole('link', { name: 'Upgrade in the console' })).not.toBeInTheDocument();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ isAuthenticated: false, accessToken: null, refreshToken: null });

  vi.mocked(marketingApi.getPlans).mockResolvedValue(planCatalog);
  vi.mocked(marketingApi.comparePlans).mockResolvedValue(comparisonFixture);
  vi.mocked(marketingApi.getSolutions).mockResolvedValue(solutionsFixture);
  vi.mocked(marketingApi.captureLead).mockResolvedValue({
    lead: {
      id: 'lead-1',
      company: 'Acme',
      contactName: 'Durai',
      contactEmail: 'durai@acme.test',
      source: 'DEMO_REQUEST',
      status: 'NEW',
      capturedAt: '2026-09-22T00:00:00.000Z',
    },
    duplicate: false,
  });
  vi.mocked(marketingApi.createDemoWorkspace).mockResolvedValue(demoFixture);
});

describe('Phase 15.1 pricing upgrades', () => {
  it('shows the comparison deltas from the compare endpoint', async () => {
    render(<PricingPage />);

    expect(await screen.findByText('What changes when you grow')).toBeInTheDocument();
    expect(await screen.findByText('Starter to Business')).toBeInTheDocument();
    await waitFor(() => {
      expect(marketingApi.comparePlans).toHaveBeenCalledWith('STARTER', 'BUSINESS');
      expect(marketingApi.comparePlans).toHaveBeenCalledWith('BUSINESS', 'ENTERPRISE');
    });
    expect(screen.getAllByText('Analytics').length).toBeGreaterThan(0);
  });

  it('gives signed-in owners an upgrade CTA into the billing console', async () => {
    useAuthStore.setState({ isAuthenticated: true });

    render(<PricingPage />);

    const upgradeLinks = await screen.findAllByRole('link', { name: 'Upgrade in the console' });
    expect(upgradeLinks).toHaveLength(3);
    expect(upgradeLinks[0]).toHaveAttribute('href', '/customer/billing');
  });
});

describe('Phase 15.1 features matrix', () => {
  it('renders the live package comparison matrix', async () => {
    render(<FeaturesPage />);

    expect(await screen.findByText('What each package includes')).toBeInTheDocument();
    expect(await screen.findByText('Executions / month')).toBeInTheDocument();
    expect(screen.getByText('AI tokens / month')).toBeInTheDocument();
    expect(screen.getByText('Workspace seats')).toBeInTheDocument();
    expect(screen.getAllByText('10,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('email (24h)').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry when the catalog fails', async () => {
    vi.mocked(marketingApi.getPlans).mockRejectedValueOnce({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Catalog unavailable',
      status: 500,
    });

    render(<FeaturesPage />);

    expect(await screen.findByText('Catalog unavailable')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(marketingApi.getPlans).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Executions / month')).toBeInTheDocument();
  });
});

describe('Phase 15.1 solutions catalog', () => {
  it('lists solutions from the catalog API with their counts', async () => {
    render(<SolutionsPage />);

    expect(await screen.findByText('Customer support automation')).toBeInTheDocument();
    expect(screen.getByText('Finance approval automation')).toBeInTheDocument();
    expect(screen.getByText(/3 workflows · 1 agents · recommended BUSINESS/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start with Customer support automation' })).toHaveAttribute(
      'href',
      '/register?plan=BUSINESS',
    );
  });

  it('filters the catalog by industry', async () => {
    render(<SolutionsPage />);

    const industry = await screen.findByLabelText('Industry');
    await userEvent.selectOptions(industry, 'Financial Services');

    expect(screen.queryByText('Customer support automation')).not.toBeInTheDocument();
    expect(screen.getByText('Finance approval automation')).toBeInTheDocument();
    expect(await screen.findByLabelText('Package')).toBeInTheDocument();
  });
});

describe('Phase 15.1 demo and contact-sales forms', () => {
  it('captures the lead and provisions a sandbox from the demo form', async () => {
    render(<DemoPage />);

    await userEvent.type(await screen.findByLabelText('Company'), 'Acme Automation');
    await userEvent.type(screen.getByLabelText('Your name'), 'Durai');
    await userEvent.type(screen.getByLabelText('Work email'), 'durai@acme.test');
    await userEvent.click(screen.getByRole('button', { name: 'Request demo and open sandbox' }));

    await waitFor(() => {
      expect(marketingApi.captureLead).toHaveBeenCalledWith(
        expect.objectContaining({
          company: 'Acme Automation',
          contactEmail: 'durai@acme.test',
          source: 'DEMO_REQUEST',
        }),
      );
    });
    expect(marketingApi.createDemoWorkspace).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Your sandbox is ready')).toBeInTheDocument();
    expect(screen.getByText(/demo-workspace-1/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open your sandbox' }));

    expect(push).toHaveBeenCalledWith('/dashboard');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('demo-access');
  });

  it('captures a sales enquiry from the contact-sales form', async () => {
    render(<ContactSalesPage />);

    await userEvent.type(await screen.findByLabelText('Company'), 'Globex');
    await userEvent.type(screen.getByLabelText('Your name'), 'Priya');
    await userEvent.type(screen.getByLabelText('Work email'), 'priya@globex.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send enquiry' }));

    await waitFor(() => {
      expect(marketingApi.captureLead).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'Globex', source: 'WEBSITE' }),
      );
    });

    expect(await screen.findByText(/Thanks/)).toBeInTheDocument();
    expect(marketingApi.createDemoWorkspace).not.toHaveBeenCalled();
  });

  it('surfaces a failed demo request instead of a sandbox', async () => {
    vi.mocked(marketingApi.createDemoWorkspace).mockRejectedValueOnce({
      code: 'RATE_LIMITED',
      message: 'Too many demo requests. Please try again later.',
      status: 429,
    });

    render(<DemoPage />);

    await userEvent.type(await screen.findByLabelText('Company'), 'Acme Automation');
    await userEvent.type(screen.getByLabelText('Your name'), 'Durai');
    await userEvent.type(screen.getByLabelText('Work email'), 'durai@acme.test');
    await userEvent.click(screen.getByRole('button', { name: 'Request demo and open sandbox' }));

    expect(
      await screen.findByText('Too many demo requests. Please try again later.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Your sandbox is ready')).not.toBeInTheDocument();
  });
});

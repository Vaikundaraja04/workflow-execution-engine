import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GrowthDashboardPage from '@/app/(app)/growth/page';
import { growthApi } from '@/services/growthApi';
import type {
  CustomerSuccessPortfolioDTO,
  GrowthConversionDTO,
  GrowthDashboardDTO,
  GrowthFunnelDTO,
  GrowthRetentionDTO,
  SalesIntelligenceReportDTO,
} from '@/services/growthApi';
import type { BusinessAnalyticsReportDTO } from '@/services/businessAnalyticsApi';

vi.mock('@/services/growthApi', () => ({
  growthApi: { getDashboard: vi.fn() },
}));

const funnelFixture: GrowthFunnelDTO = {
  window: { since: '2026-09-01T00:00:00.000Z', until: '2026-09-22T00:00:00.000Z', days: 30 },
  steps: [
    { event: 'LANDING_VIEW', count: 1024, conversionFromPrevious: null, conversionFromStart: 100 },
    { event: 'SIGNUP_COMPLETED', count: 256, conversionFromPrevious: 25, conversionFromStart: 25 },
    { event: 'DEMO_STARTED', count: 128, conversionFromPrevious: 50, conversionFromStart: 12.5 },
    { event: 'CUSTOMER_CONVERTED', count: 64, conversionFromPrevious: 50, conversionFromStart: 6.3 },
  ],
  totals: { visitors: 1024, signups: 256, demos: 128, trials: 96, payments: 70, customers: 64, churned: 3 },
  rates: {
    visitorToSignupPercent: 25,
    signupToDemoPercent: 50,
    demoToCustomerPercent: 50,
    trialToCustomerPercent: 66.7,
    visitorToCustomerPercent: 6.3,
    customerToChurnPercent: 4.5,
  },
  bySource: [{ source: 'WEBSITE', visitors: 800, signups: 200, demos: 100, customers: 50, conversionPercent: 6.3 }],
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const conversionFixture: GrowthConversionDTO = {
  window: { since: '2026-09-01T00:00:00.000Z', until: '2026-09-22T00:00:00.000Z', days: 30 },
  bySource: [],
  cac: {
    spend: 250000,
    currency: 'USD',
    customersAcquired: 64,
    costPerAcquisition: 3906,
    note: 'CAC = supplied spend / customers converted in the window',
  },
  activation: {
    windowDays: 14,
    evaluated: 256,
    activated: 192,
    activationRatePercent: 75,
    note: 'Activated = first workflow execution within 14 days of signup',
  },
  rates: { signupToDemoPercent: 50, demoToCustomerPercent: 50, trialToPaidPercent: 66.7 },
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const retentionFixture: GrowthRetentionDTO = {
  window: { months: 6, since: '2026-04-01T00:00:00.000Z', until: '2026-09-22T00:00:00.000Z' },
  cohorts: [{ cohortMonth: '2026-09', size: 64, retained: [{ monthOffset: 0, active: 60, percent: 93.8 }] }],
  churn: {
    churnedInWindow: 3,
    startingBase: 120,
    churnRatePercent: 2.5,
    note: 'Starting base = workspaces converted before the window; churn counts CUSTOMER_CHURNED events inside it',
  },
  ltv: {
    arpa: 9900,
    churnRatePercent: 2.5,
    estimatedLifetimeMonths: 40,
    note: 'Lifetime months = 100 / churn rate; LTV value = ARPA x lifetime months',
  },
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const customersFixture: CustomerSuccessPortfolioDTO = {
  customers: [
    {
      workspaceId: 'w-1',
      companyName: 'Acme Automation',
      plan: 'PROFESSIONAL',
      packageId: 'BUSINESS',
      packageName: 'Business',
      tenantStatus: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      score: 82,
      band: 'healthy',
      category: 'Healthy',
      adoption: { activeUsers: 5, totalMembers: 6, activeUserPercent: 83.3, adoptedFeatureCount: 3, totalFeatureCount: 5, features: [] },
      operations: { executions30d: 4200, failedExecutions30d: 12, failureRatePercent: 0.3, topFailingWorkflows: [] },
      aiUsage: { tokensThisMonth: 91000, tokenLimit: 100000, utilizationPercent: 91 },
      risks: [],
      recommendations: [],
      generatedAt: '2026-09-22T10:00:00.000Z',
    },
    {
      workspaceId: 'w-2',
      companyName: 'Initech',
      plan: 'STARTER',
      packageId: 'STARTER',
      packageName: 'Starter',
      tenantStatus: 'TRIALING',
      subscriptionStatus: 'TRIALING',
      score: 38,
      band: 'critical',
      category: 'Critical',
      adoption: { activeUsers: 1, totalMembers: 8, activeUserPercent: 12.5, adoptedFeatureCount: 1, totalFeatureCount: 5, features: [] },
      operations: { executions30d: 40, failedExecutions30d: 9, failureRatePercent: 22.5, topFailingWorkflows: [{ workflowId: 'wf-1', name: 'Invoice approval', failures: 6 }] },
      aiUsage: { tokensThisMonth: 0, tokenLimit: null, utilizationPercent: null },
      risks: [{ code: 'HIGH_FAILURE_RATE', severity: 'HIGH', message: 'Failure rate is above the healthy threshold' }],
      recommendations: [{ code: 'INVESTIGATE_FAILURES', action: 'Investigate the failing workflow', priority: 'HIGH', owner: 'CSM' }],
      generatedAt: '2026-09-22T10:00:00.000Z',
    },
  ],
  summary: { total: 2, healthy: 1, atRisk: 0, critical: 1, averageScore: 60, averageActiveUserPercent: 47.9, failingWorkflows: 1 },
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const salesFixture: SalesIntelligenceReportDTO = {
  leads: [
    {
      leadId: 'l-1',
      company: 'Initech',
      contactName: 'Peter Gibbons',
      contactEmail: 'peter@initech.test',
      industry: 'Technology',
      companySize: '201-1000',
      interest: 'BUSINESS',
      source: 'PRICING_PAGE',
      status: 'QUALIFIED',
      score: 78,
      band: 'HOT',
      factors: [],
      engagement: { score: 80, pricingVisits: 4, demoExecutions: 2, workflowsCreated: 3, teamInvitations: 2, lastActivityAt: '2026-09-21T00:00:00.000Z' },
      companyPriority: { tier: 'MID_MARKET', score: 70, reason: '201-1000 employees in Technology' },
      buyingIntent: { band: 'HIGH', score: 80, signals: ['pricing visits'] },
      recommendations: [{ code: 'SCHEDULE_DEMO', action: 'Schedule the technical demo', priority: 'HIGH', owner: 'AE' }],
      followUpStatus: 'DUE',
      capturedAt: '2026-09-15T00:00:00.000Z',
    },
  ],
  summary: {
    total: 1,
    bands: { hot: 1, warm: 0, nurture: 0, cold: 0 },
    averageScore: 78,
    pipelineValueMonthly: 9900,
    followUps: { overdue: 0, due: 1 },
    topOpportunity: { leadId: 'l-1', company: 'Initech', score: 78 },
  },
  generatedAt: '2026-09-22T10:00:00.000Z',
};

const revenueFixture: BusinessAnalyticsReportDTO['revenue'] = {
  currency: 'usd',
  mrr: 9900,
  arr: 118800,
  arpa: 9900,
  payingCustomers: 1,
  trialingCustomers: 2,
  planMix: [],
};

const dashboardFixture: GrowthDashboardDTO = {
  funnel: funnelFixture,
  conversion: conversionFixture,
  retention: retentionFixture,
  customers: customersFixture,
  sales: salesFixture,
  revenue: revenueFixture,
};

describe('Phase 16 growth dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(growthApi.getDashboard).mockResolvedValue(dashboardFixture);
  });

  it('renders the funnel, revenue, customer health and ranked pipeline', async () => {
    render(<GrowthDashboardPage />);

    expect(await screen.findByText('Growth dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Growth overview')).toBeInTheDocument();
    expect(screen.getByText('Acquisition funnel')).toBeInTheDocument();
    expect(screen.getByText('Sales pipeline')).toBeInTheDocument();
    expect(screen.getByText('Customer health')).toBeInTheDocument();
    expect(screen.getAllByText('$99')).toHaveLength(2);
    expect(screen.getByText('$1,188')).toBeInTheDocument();
    expect(screen.getByText('$39')).toBeInTheDocument();
    expect(screen.getByText(/2 customers scored by the success layer/)).toBeInTheDocument();
    expect(screen.getByText(/1 leads ranked by score/)).toBeInTheDocument();
    expect(screen.getByText('Schedule the technical demo')).toBeInTheDocument();
    expect(screen.getByText('Acme Automation')).toBeInTheDocument();
    expect(screen.getAllByText('Critical')).toHaveLength(2);
  });

  it('reloads the dashboard when the window changes', async () => {
    render(<GrowthDashboardPage />);

    await screen.findByText('Growth dashboard');
    await waitFor(() => {
      expect(growthApi.getDashboard).toHaveBeenCalledWith(30);
    });

    await userEvent.selectOptions(screen.getByLabelText('Window'), 'Last 90 days');

    await waitFor(() => {
      expect(growthApi.getDashboard).toHaveBeenCalledWith(90);
    });
  });

  it('surfaces the administrator-only error from the endpoints', async () => {
    vi.mocked(growthApi.getDashboard).mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Platform administrators only',
      status: 403,
    });

    render(<GrowthDashboardPage />);

    expect(await screen.findByText('Platform administrators only')).toBeInTheDocument();
  });
});

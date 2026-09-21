export type TenantStatusDTO = 'TRIALING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type PlanIdDTO = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
export type AlertStateDTO = 'OK' | 'WARNING' | 'EXCEEDED';
export type UsageMetricDTO = 'EXECUTIONS' | 'AI_TOKENS' | 'AGENT_RUNS' | 'STORAGE_BYTES' | 'API_REQUESTS';

export interface TenantOnboardingDTO {
  completed: boolean;
  steps: string[];
  startedAt: string;
  completedAt: string | null;
}

export interface TenantDTO {
  id: string;
  workspaceId: string;
  companyName: string;
  status: TenantStatusDTO;
  plan: PlanIdDTO;
  region: string;
  trialEndsAt: string | null;
  demo: boolean;
  useCase: string | null;
  onboarding: TenantOnboardingDTO;
}

export interface CustomerProfileDTO {
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  company: string;
  billingAddress: { line1?: string; city?: string; country?: string } | null;
  taxId: string | null;
  timezone: string;
  locale: string;
}

export interface SubscriptionDTO {
  id: string;
  plan: PlanIdDTO;
  status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
  billingProvider: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
}

export interface MeterReadingDTO {
  metric: UsageMetricDTO;
  value: number;
  limit: number | null;
  percent: number;
  alertState: AlertStateDTO;
  overage: boolean;
  periodKey: string;
}

export interface UsageSummaryDTO {
  workspaceId: string;
  plan: PlanIdDTO | null;
  periodKey: string;
  metrics: MeterReadingDTO[];
  generatedAt: string;
}

export interface UsageHistoryDTO {
  workspaceId: string;
  days: number;
  series: Array<{ metric: UsageMetricDTO; points: Array<{ periodKey: string; value: number }> }>;
}

export interface InvoiceDTO {
  id: string;
  customerId: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: number;
  dueDate: number | null;
  paid: boolean;
  hostedInvoiceUrl?: string;
}

export interface AccountDTO {
  tenant: TenantDTO;
  profile: CustomerProfileDTO | null;
  subscription: SubscriptionDTO | null;
  usage: UsageSummaryDTO;
}
export interface CustomerHealthDTO {
  score: number;
  band: 'healthy' | 'watch' | 'at_risk';
  factors: { subscription: number; usagePressure: number; activity: number };
}

export interface CustomerRowDTO {
  tenantId: string;
  workspaceId: string;
  companyName: string;
  status: TenantStatusDTO;
  workspaceStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED' | null;
  plan: PlanIdDTO;
  region: string;
  demo: boolean;
  createdAt: string;
  subscription: {
    status: SubscriptionDTO['status'];
    billingProvider: string;
    currentPeriodEnd: string;
    trialEndsAt: string | null;
  } | null;
  usage: {
    executionsThisMonth: number;
    storageBytes: number;
    warningMetrics: UsageMetricDTO[];
    exceededMetrics: UsageMetricDTO[];
  };
  health: CustomerHealthDTO;
}

export interface CustomerListDTO {
  customers: CustomerRowDTO[];
  total: number;
  limit: number;
  offset: number;
}

export interface CustomerDetailDTO {
  tenant: TenantDTO & { createdAt: string };
  profile:
    | (CustomerProfileDTO & {
        supportNotes: Array<{ authorUserId: string; note: string; createdAt: string }>;
      })
    | null;
  workspace: { id: string; name: string; slug: string; status: string; region: string | null } | null;
  subscription: SubscriptionDTO | null;
  usage: {
    totalWorkflows: number;
    monthlyExecutions: number;
    storageUsed: number;
    updatedAt: string;
  } | null;
}

export interface CatalogPlanDTO {
  id: PlanIdDTO;
  name: string;
  description: string;
  priceMonthly: number;
  currency: string;
  limits: {
    workflows: number;
    executionsPerMonth: number;
    apiKeys: number;
    webhooks: number;
    members: number;
    storageBytes: number;
  };
  features: string[];
}

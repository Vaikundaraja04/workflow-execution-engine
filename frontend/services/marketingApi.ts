import { apiClient } from './apiClient';

/**
 * Phase 15.1 - Public go-to-market API client.
 *
 * Backs the marketing site: the sellable package catalog, package comparison,
 * the industry solution catalog and lead capture. These endpoints are public,
 * so the calls work for signed-out visitors too.
 */

export type MarketingPackageId = 'STARTER' | 'BUSINESS' | 'ENTERPRISE';
export type SupportLevel = 'COMMUNITY' | 'EMAIL' | 'PRIORITY' | 'DEDICATED';
export type LeadSourceDTO = 'WEBSITE' | 'PRICING_PAGE' | 'DEMO_REQUEST' | 'REFERRAL' | 'OTHER';

export interface MarketingPackaging {
  includedWorkflows: number;
  executionLimit: number;
  aiRequestLimit: number;
  agentLimit: number;
  storageBytes: number;
  seats: number;
  supportLevel: SupportLevel;
  supportResponseHours: number | null;
  trialDays: number;
}

export interface MarketingPlan {
  id: MarketingPackageId;
  name: string;
  tagline: string;
  description: string;
  audience: string;
  internalPlan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  priceMonthly: number;
  annualPriceMonthly: number;
  currency: string;
  packaging: MarketingPackaging;
  entitlements: string[];
  highlights: string[];
  addOns: string[];
  sortOrder: number;
}

export interface MarketingFreeTier {
  packageId: null;
  name: string;
  priceMonthly: number;
  currency: string;
  internalPlan: 'FREE';
}

export interface MarketingPlanCatalog {
  plans: MarketingPlan[];
  freeTier: MarketingFreeTier;
  aliases: Record<string, string>;
}

export interface PlanComparisonSide {
  packageId: MarketingPackageId;
  name: string;
  priceMonthly: number;
  currency: string;
}

export interface PlanComparisonDTO {
  from: PlanComparisonSide;
  to: PlanComparisonSide;
  priceDeltaPercent: number;
  upgrade: boolean;
  limitDeltas: Array<{
    field: string;
    from: number | string | null;
    to: number | string | null;
    delta: number | null;
  }>;
  entitlementsAdded: string[];
  entitlementsRemoved: string[];
  recommended: boolean;
}

export interface SolutionSummaryDTO {
  id: string;
  name: string;
  industry: string;
  summary: string;
  outcomes: string[];
  recommendedPackage: MarketingPackageId;
  tags: string[];
  workflowCount: number;
  agentCount: number;
}

export interface LeadCaptureInput {
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  industry?: string;
  companySize?: string;
  interest?: string;
  message?: string;
  source?: LeadSourceDTO;
  utm?: Record<string, string>;
}

export interface CapturedLeadDTO {
  id: string;
  company: string;
  contactName: string;
  contactEmail: string;
  source: string;
  status: string;
  capturedAt: string;
}

export interface LeadCaptureResultDTO {
  lead: CapturedLeadDTO;
  duplicate: boolean;
}

export interface DemoWorkspaceDTO {
  workspaceId: string;
  tenantId: string;
  ownerUserId: string;
  demoExpiresAt: string;
  workflowIds: string[];
  agentIds: string[];
  tokens: { accessToken: string; refreshToken: string };
}

export const marketingApi = {
  /** Live sellable package catalog (Starter / Business / Enterprise + free tier). */
  getPlans: async (): Promise<MarketingPlanCatalog> => {
    const response = await apiClient.get<MarketingPlanCatalog>('/api/v1/marketing/plans');
    return response.data;
  },

  /** What changes between two packages (price delta, limit deltas, entitlements). */
  comparePlans: async (
    from: MarketingPackageId,
    to: MarketingPackageId,
  ): Promise<PlanComparisonDTO> => {
    const response = await apiClient.get<PlanComparisonDTO>('/api/v1/marketing/plans/compare', {
      params: { from, to },
    });
    return response.data;
  },

  /** Industry solution catalog with optional filters. */
  getSolutions: async (
    params: { industry?: string; package?: string } = {},
  ): Promise<SolutionSummaryDTO[]> => {
    const response = await apiClient.get<{ solutions: SolutionSummaryDTO[] }>('/api/v1/solutions', {
      params,
    });
    return response.data.solutions;
  },

  /** Capture an inbound lead from a website form. */
  captureLead: async (input: LeadCaptureInput): Promise<LeadCaptureResultDTO> => {
    const response = await apiClient.post<LeadCaptureResultDTO>('/api/v1/marketing/leads', input);
    return response.data;
  },

  /** Provision an instant demo sandbox with sign-in tokens. */
  createDemoWorkspace: async (): Promise<DemoWorkspaceDTO> => {
    const response = await apiClient.post<DemoWorkspaceDTO>('/api/v1/demo/create', {});
    return response.data;
  },
};

export default marketingApi;

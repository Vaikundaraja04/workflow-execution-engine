import { apiClient } from './apiClient';

/**
 * Phase 15.8 - Business analytics dashboard client.
 *
 * Backs /analytics/business with the platform report: acquisition funnel,
 * revenue (MRR/ARR/ARPA and plan mix), customer base, churn and the health
 * overlay. The endpoint is platform-administrator only; consumers surface the
 * 403 through their error state.
 */

export interface FunnelSourceDTO {
  source: string;
  landing: number;
  signups: number;
  subscriptions: number;
}

export interface PlanMixDTO {
  packageId: string;
  name: string;
  subscriptions: number;
  mrr: number;
  sharePercent: number;
}

export interface BusinessAnalyticsReportDTO {
  window: { since: string; until: string; days: number };
  acquisition: {
    visitors: number;
    signups: number;
    demos: number;
    subscriptions: number;
    visitToSignupPercent: number;
    signupToSubscriptionPercent: number;
    visitToSubscriptionPercent: number;
    bySource: FunnelSourceDTO[];
  };
  revenue: {
    currency: string;
    mrr: number;
    arr: number;
    arpa: number;
    payingCustomers: number;
    trialingCustomers: number;
    planMix: PlanMixDTO[];
  };
  customers: {
    active: number;
    newInWindow: number;
    trialsEndingSoon: number;
    churned: number;
    startingBase: number;
    churnRatePercent: number;
  };
  health: {
    evaluated: number;
    healthy: number;
    watch: number;
    atRisk: number;
  };
  generatedAt: string;
}

export const businessAnalyticsApi = {
  getReport: async (days: number = 30): Promise<BusinessAnalyticsReportDTO> => {
    const response = await apiClient.get<BusinessAnalyticsReportDTO>('/api/v1/analytics/business', {
      params: { days },
    });
    return response.data;
  },
};

export default businessAnalyticsApi;

import { apiClient } from './apiClient';
import { businessAnalyticsApi } from './businessAnalyticsApi';
import type { BusinessAnalyticsReportDTO } from './businessAnalyticsApi';

/**
 * Phase 16 - Growth dashboard client.
 *
 * Backs /growth with the Phase 16 platform reports: the acquisition funnel,
 * per-source conversion with CAC and activation, cohort retention, the customer
 * success portfolio and the ranked sales pipeline. Revenue (MRR/ARR/ARPA) stays
 * owned by the Phase 15.8 business analytics report - the dashboard reuses it
 * instead of recomputing it. Every endpoint is platform-administrator only.
 */

export interface GrowthFunnelStepDTO {
  event: string;
  count: number;
  conversionFromPrevious: number | null;
  conversionFromStart: number | null;
}

export interface GrowthFunnelDTO {
  window: { since: string; until: string; days: number };
  steps: GrowthFunnelStepDTO[];
  totals: {
    visitors: number;
    signups: number;
    demos: number;
    trials: number;
    payments: number;
    customers: number;
    churned: number;
  };
  rates: {
    visitorToSignupPercent: number;
    signupToDemoPercent: number;
    demoToCustomerPercent: number;
    trialToCustomerPercent: number;
    visitorToCustomerPercent: number;
    customerToChurnPercent: number;
  };
  bySource: Array<{
    source: string;
    visitors: number;
    signups: number;
    demos: number;
    customers: number;
    conversionPercent: number;
  }>;
  generatedAt: string;
}

export interface GrowthConversionDTO {
  window: { since: string; until: string; days: number };
  bySource: Array<{
    source: string;
    visitors: number;
    signups: number;
    customers: number;
    signupPercent: number;
    customerPercent: number;
  }>;
  cac: {
    spend: number | null;
    currency: string;
    customersAcquired: number;
    costPerAcquisition: number | null;
    note: string;
  };
  activation: {
    windowDays: number;
    evaluated: number;
    activated: number;
    activationRatePercent: number;
    note: string;
  };
  rates: {
    signupToDemoPercent: number;
    demoToCustomerPercent: number;
    trialToPaidPercent: number;
  };
  generatedAt: string;
}

export interface GrowthRetentionDTO {
  window: { months: number; since: string; until: string };
  cohorts: Array<{
    cohortMonth: string;
    size: number;
    retained: Array<{ monthOffset: number; active: number; percent: number }>;
  }>;
  churn: {
    churnedInWindow: number;
    startingBase: number;
    churnRatePercent: number;
    note: string;
  };
  ltv: {
    arpa: number | null;
    churnRatePercent: number;
    estimatedLifetimeMonths: number | null;
    note: string;
  };
  generatedAt: string;
}

export interface CustomerSuccessReportDTO {
  workspaceId: string;
  companyName: string;
  plan: string | null;
  packageId: string | null;
  packageName: string | null;
  tenantStatus: string | null;
  subscriptionStatus: string | null;
  score: number;
  band: string;
  category: 'Healthy' | 'At Risk' | 'Critical';
  adoption: {
    activeUsers: number;
    totalMembers: number;
    activeUserPercent: number;
    adoptedFeatureCount: number;
    totalFeatureCount: number;
    features: Array<{ feature: string; adopted: boolean; detail: string }>;
  };
  operations: {
    executions30d: number;
    failedExecutions30d: number;
    failureRatePercent: number;
    topFailingWorkflows: Array<{ workflowId: string; name: string; failures: number }>;
  };
  aiUsage: {
    tokensThisMonth: number;
    tokenLimit: number | null;
    utilizationPercent: number | null;
  };
  risks: Array<{ code: string; severity: string; message: string }>;
  recommendations: Array<{ code: string; action: string; priority: string; owner: string }>;
  generatedAt: string;
}

export interface CustomerSuccessPortfolioDTO {
  customers: CustomerSuccessReportDTO[];
  summary: {
    total: number;
    healthy: number;
    atRisk: number;
    critical: number;
    averageScore: number;
    averageActiveUserPercent: number;
    failingWorkflows: number;
  };
  generatedAt: string;
}

export interface SalesLeadIntelligenceDTO {
  leadId: string;
  company: string;
  contactName: string;
  contactEmail: string;
  industry: string;
  companySize: string | null;
  interest: string | null;
  source: string;
  status: string;
  score: number;
  band: 'HOT' | 'WARM' | 'NURTURE' | 'COLD';
  factors: Array<{ factor: string; label: string; weight: number; score: number; detail: string }>;
  engagement: {
    score: number;
    pricingVisits: number;
    demoExecutions: number;
    workflowsCreated: number;
    teamInvitations: number;
    lastActivityAt: string | null;
  };
  companyPriority: { tier: string; score: number; reason: string };
  buyingIntent: { band: string; score: number; signals: string[] };
  recommendations: Array<{ code: string; action: string; priority: string; owner: string }>;
  followUpStatus: string;
  capturedAt: string;
}

export interface SalesIntelligenceReportDTO {
  leads: SalesLeadIntelligenceDTO[];
  summary: {
    total: number;
    bands: { hot: number; warm: number; nurture: number; cold: number };
    averageScore: number;
    pipelineValueMonthly: number;
    followUps: { overdue: number; due: number };
    topOpportunity: { leadId: string; company: string; score: number } | null;
  };
  generatedAt: string;
}

export interface GrowthDashboardDTO {
  funnel: GrowthFunnelDTO;
  conversion: GrowthConversionDTO;
  retention: GrowthRetentionDTO;
  customers: CustomerSuccessPortfolioDTO;
  sales: SalesIntelligenceReportDTO;
  revenue: BusinessAnalyticsReportDTO['revenue'];
}

export const growthApi = {
  getDashboard: async (days: number = 30, months: number = 6): Promise<GrowthDashboardDTO> => {
    const [funnel, conversion, retention, customers, sales, business] = await Promise.all([
      apiClient.get<GrowthFunnelDTO>('/api/v1/growth/funnel', { params: { days } }),
      apiClient.get<GrowthConversionDTO>('/api/v1/growth/conversion', { params: { days } }),
      apiClient.get<GrowthRetentionDTO>('/api/v1/growth/retention', { params: { months } }),
      apiClient.get<CustomerSuccessPortfolioDTO>('/api/v1/customers/health'),
      apiClient.get<SalesIntelligenceReportDTO>('/api/v1/sales/intelligence'),
      businessAnalyticsApi.getReport(days),
    ]);
    return {
      funnel: funnel.data,
      conversion: conversion.data,
      retention: retention.data,
      customers: customers.data,
      sales: sales.data,
      revenue: business.revenue,
    };
  },
};

export default growthApi;

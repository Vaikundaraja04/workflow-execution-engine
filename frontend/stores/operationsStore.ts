import { create } from 'zustand';
import { operationsApi } from '../services/operationsApi';
import type {
  OverviewAnalyticsData,
  WorkflowAnalyticsData,
  ExecutionAnalyticsData,
  UserAnalyticsData,
  PerformanceAnalyticsData,
  CostAnalyticsData,
  SystemObservabilityHealth,
  SystemMetricsData,
  SecurityIntelligenceData,
  AIOperationsFailureExplanation,
  AIOperationsSystemSummary,
  AIOperationsOptimizationSuggestion,
  ReportItem,
} from '@/types/operations.types';

interface OperationsState {
  // Analytics
  overview: OverviewAnalyticsData | null;
  workflows: WorkflowAnalyticsData | null;
  executions: ExecutionAnalyticsData | null;
  users: UserAnalyticsData | null;
  performance: PerformanceAnalyticsData | null;
  cost: CostAnalyticsData | null;

  // Observability
  systemHealth: SystemObservabilityHealth | null;
  systemMetrics: SystemMetricsData | null;

  // Security Intelligence
  securityIntelligence: SecurityIntelligenceData | null;

  // AI Operations Assistant
  failureExplanation: AIOperationsFailureExplanation | null;
  systemSummary: AIOperationsSystemSummary | null;
  optimizationSuggestions: AIOperationsOptimizationSuggestion[];
  anomalies: Array<{
    id: string;
    type: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    detectedAt: string;
    recommendation: string;
  }>;
  scalingRecommendations: {
    currentConcurrency: number;
    recommendedWorkers: number;
    estimatedThroughputGainPercent: number;
    reasoning: string;
    recommendations: string[];
  } | null;

  // Reports
  reports: ReportItem[];
  totalReports: number;

  // UI State
  isLoading: boolean;
  error: string | null;
  activeTab: 'overview' | 'workflows' | 'executions' | 'users' | 'performance' | 'cost' | 'system' | 'security' | 'ai' | 'reports';

  // Actions - Analytics
  fetchOverviewAnalytics: (workspaceId: string, timeframe?: string) => Promise<void>;
  fetchWorkflowAnalytics: (workspaceId: string, timeframe?: string) => Promise<void>;
  fetchExecutionAnalytics: (workspaceId: string, timeframe?: string) => Promise<void>;
  fetchUserAnalytics: (workspaceId: string, timeframe?: string) => Promise<void>;
  fetchPerformanceAnalytics: (workspaceId: string, timeframe?: string) => Promise<void>;
  fetchCostAnalytics: (workspaceId: string, timeframe?: string) => Promise<void>;
  exportAnalyticsData: (workspaceId: string, type: string, format?: 'json' | 'csv') => Promise<{ data: Blob; filename: string }>;

  // Actions - Observability
  fetchSystemHealth: () => Promise<void>;
  fetchSystemMetrics: () => Promise<void>;
  fetchSystemStatus: () => Promise<{ status: string; uptimeSeconds: number; timestamp: string; environment: string; nodeVersion: string; services: SystemObservabilityHealth['services']; metrics: SystemMetricsData }>;

  // Actions - Security Intelligence
  fetchSecurityIntelligence: (workspaceId: string) => Promise<void>;
  scanSecurityIntelligence: (workspaceId: string, userId: string) => Promise<void>;

  // Actions - AI Operations Assistant
  explainWorkflowFailure: (executionId: string, workspaceId: string, userId?: string) => Promise<void>;
  summarizeSystemHealth: (workspaceId: string, userId?: string) => Promise<void>;
  suggestOptimizations: (workspaceId: string) => Promise<void>;
  detectSystemAnomalies: (workspaceId: string) => Promise<void>;
  recommendScalingActions: (workspaceId: string) => Promise<void>;

  // Actions - Reports
  createReport: (workspaceId: string, userId: string, input: { name: string; type: string; format?: string; filters?: Record<string, unknown>; schedule?: { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; nextRunAt?: Date; isActive: boolean; recipients?: string[] } }) => Promise<ReportItem>;
  getReports: (workspaceId: string, filters?: { type?: string; status?: string }) => Promise<void>;
  getReportById: (reportId: string, workspaceId: string) => Promise<ReportItem | null>;
  deleteReport: (reportId: string, workspaceId: string, userId: string) => Promise<boolean>;
  exportReport: (reportId: string, workspaceId: string, formatOverride?: string) => Promise<{ data: Blob; filename: string }>;

  // Actions - UI
  setActiveTab: (tab: OperationsState['activeTab']) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useOperationsStore = create<OperationsState>((set, get) => ({
  // Initial state
  overview: null,
  workflows: null,
  executions: null,
  users: null,
  performance: null,
  cost: null,
  systemHealth: null,
  systemMetrics: null,
  securityIntelligence: null,
  failureExplanation: null,
  systemSummary: null,
  optimizationSuggestions: [],
  anomalies: [],
  scalingRecommendations: null,
  reports: [],
  totalReports: 0,
  isLoading: false,
  error: null,
  activeTab: 'overview',

  // Analytics Actions
  fetchOverviewAnalytics: async (workspaceId, timeframe = '30d') => {
    set({ isLoading: true, error: null });
    try {
      const overview = await operationsApi.getOverviewAnalytics(workspaceId, timeframe);
      set({ overview, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch overview analytics', isLoading: false });
    }
  },

  fetchWorkflowAnalytics: async (workspaceId, timeframe = '30d') => {
    set({ isLoading: true, error: null });
    try {
      const workflows = await operationsApi.getWorkflowAnalytics(workspaceId, timeframe);
      set({ workflows, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch workflow analytics', isLoading: false });
    }
  },

  fetchExecutionAnalytics: async (workspaceId, timeframe = '30d') => {
    set({ isLoading: true, error: null });
    try {
      const executions = await operationsApi.getExecutionAnalytics(workspaceId, timeframe);
      set({ executions, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch execution analytics', isLoading: false });
    }
  },

  fetchUserAnalytics: async (workspaceId, timeframe = '30d') => {
    set({ isLoading: true, error: null });
    try {
      const users = await operationsApi.getUserAnalytics(workspaceId, timeframe);
      set({ users, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch user analytics', isLoading: false });
    }
  },

  fetchPerformanceAnalytics: async (workspaceId, timeframe = '30d') => {
    set({ isLoading: true, error: null });
    try {
      const performance = await operationsApi.getPerformanceAnalytics(workspaceId, timeframe);
      set({ performance, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch performance analytics', isLoading: false });
    }
  },

  fetchCostAnalytics: async (workspaceId, timeframe = '30d') => {
    set({ isLoading: true, error: null });
    try {
      const cost = await operationsApi.getCostAnalytics(workspaceId, timeframe);
      set({ cost, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch cost analytics', isLoading: false });
    }
  },

  exportAnalyticsData: async (workspaceId, type, format = 'json') => {
    return await operationsApi.exportAnalyticsData(workspaceId, type, format);
  },

  // Observability Actions
  fetchSystemHealth: async () => {
    set({ isLoading: true, error: null });
    try {
      const systemHealth = await operationsApi.getSystemHealth();
      set({ systemHealth, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch system health', isLoading: false });
    }
  },

  fetchSystemMetrics: async () => {
    set({ isLoading: true, error: null });
    try {
      const systemMetrics = await operationsApi.getSystemMetrics();
      set({ systemMetrics, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch system metrics', isLoading: false });
    }
  },

  fetchSystemStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const status = await operationsApi.getSystemStatus();
      set({ isLoading: false });
      return status;
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch system status', isLoading: false });
      throw err;
    }
  },

  // Security Intelligence Actions
  fetchSecurityIntelligence: async (workspaceId) => {
    set({ isLoading: true, error: null });
    try {
      const securityIntelligence = await operationsApi.getSecurityIntelligence(workspaceId);
      set({ securityIntelligence, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch security intelligence', isLoading: false });
    }
  },

  scanSecurityIntelligence: async (workspaceId, userId) => {
    set({ isLoading: true, error: null });
    try {
      const securityIntelligence = await operationsApi.scanSecurityIntelligence(workspaceId, userId);
      set({ securityIntelligence, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to scan security intelligence', isLoading: false });
    }
  },

  // AI Operations Assistant Actions
  explainWorkflowFailure: async (executionId, workspaceId, userId) => {
    set({ isLoading: true, error: null });
    try {
      const failureExplanation = await operationsApi.explainWorkflowFailure(executionId, workspaceId, userId);
      set({ failureExplanation, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to explain workflow failure', isLoading: false });
    }
  },

  summarizeSystemHealth: async (workspaceId, userId) => {
    set({ isLoading: true, error: null });
    try {
      const systemSummary = await operationsApi.summarizeSystemHealth(workspaceId, userId);
      set({ systemSummary, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to summarize system health', isLoading: false });
    }
  },

  suggestOptimizations: async (workspaceId) => {
    set({ isLoading: true, error: null });
    try {
      const optimizationSuggestions = await operationsApi.suggestOptimizations(workspaceId);
      set({ optimizationSuggestions, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to suggest optimizations', isLoading: false });
    }
  },

  detectSystemAnomalies: async (workspaceId) => {
    set({ isLoading: true, error: null });
    try {
      const { anomalies } = await operationsApi.detectSystemAnomalies(workspaceId);
      set({ anomalies, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to detect system anomalies', isLoading: false });
    }
  },

  recommendScalingActions: async (workspaceId) => {
    set({ isLoading: true, error: null });
    try {
      const scalingRecommendations = await operationsApi.recommendScalingActions(workspaceId);
      set({ scalingRecommendations, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to recommend scaling actions', isLoading: false });
    }
  },

  // Report Actions
  createReport: async (workspaceId, userId, input) => {
    set({ isLoading: true, error: null });
    try {
      const report = await operationsApi.createReport(workspaceId, userId, input);
      // Update reports list
      const { reports } = get();
      set({ reports: [report, ...reports], totalReports: reports.length + 1, isLoading: false });
      return report;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create report', isLoading: false });
      throw err;
    }
  },

  getReports: async (workspaceId, filters = {}) => {
    set({ isLoading: true, error: null });
    try {
      const reports = await operationsApi.getReports(workspaceId, filters);
      set({ reports, totalReports: reports.length, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch reports', isLoading: false });
    }
  },

  getReportById: async (reportId, workspaceId) => {
    set({ isLoading: true, error: null });
    try {
      const report = await operationsApi.getReportById(reportId, workspaceId);
      set({ isLoading: false });
      return report;
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch report by ID', isLoading: false });
      return null;
    }
  },

  deleteReport: async (reportId, workspaceId, userId) => {
    set({ isLoading: true, error: null });
    try {
      const success = await operationsApi.deleteReport(reportId, workspaceId, userId);
      if (success) {
        // Remove report from list
        set((state) => ({
          reports: state.reports.filter((report) => report.id !== reportId),
          totalReports: state.totalReports - 1,
          isLoading: false,
        }));
      }
      return success;
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete report', isLoading: false });
      throw err;
    }
  },

  exportReport: async (reportId, workspaceId, formatOverride) => {
    return await operationsApi.exportReport(reportId, workspaceId, formatOverride);
  },

  // UI Actions
  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },

  setLoading: (isLoading) => {
    set({ isLoading });
  },

  setError: (error) => {
    set({ error });
  },

  clearError: () => {
    set({ error: null });
  },
}));
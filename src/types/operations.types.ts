import type { ReportType, ReportStatus, ReportFormat } from '../models/ReportModel.js';

export interface OverviewAnalyticsData {
  workspaceId: string;
  timeframe: string;
  totalWorkflows: number;
  activeWorkflows: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
  totalCostUsd: number;
  activeUsersCount: number;
  executionTrend: Array<{
    date: string;
    total: number;
    succeeded: number;
    failed: number;
  }>;
}

export interface WorkflowAnalyticsData {
  workspaceId: string;
  timeframe: string;
  workflows: Array<{
    workflowId: string;
    name: string;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    avgDurationMs: number;
    lastExecutedAt?: string | undefined;
  }>;
  mostFailingNodes: Array<{
    nodeId: string;
    nodeType: string;
    failureCount: number;
    errorSample?: string | undefined;
  }>;
}

export interface ExecutionAnalyticsData {
  workspaceId: string;
  timeframe: string;
  totalExecutions: number;
  successRate: number;
  hourlyThroughput: Array<{
    hour: string;
    count: number;
    successRate: number;
  }>;
  statusBreakdown: {
    succeeded: number;
    failed: number;
    running: number;
    queued: number;
    cancelled: number;
  };
  latencyPercentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    avg: number;
  };
  retryStats: {
    totalRetries: number;
    successfulAfterRetry: number;
    failedAfterRetry: number;
  };
}

export interface UserAnalyticsData {
  workspaceId: string;
  timeframe: string;
  users: Array<{
    userId: string;
    email: string;
    name: string;
    role: string;
    workflowsCreated: number;
    executionsTriggered: number;
    lastActiveAt?: string | undefined;
  }>;
  totalMembers: number;
}

export interface PerformanceAnalyticsData {
  workspaceId: string;
  timeframe: string;
  avgResponseTimeMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  slowestWorkflows: Array<{
    workflowId: string;
    name: string;
    avgDurationMs: number;
    p95DurationMs: number;
  }>;
  nodeExecutionTimes: Array<{
    nodeType: string;
    avgDurationMs: number;
    count: number;
  }>;
}

export interface CostAnalyticsData {
  workspaceId: string;
  timeframe: string;
  totalCostUsd: number;
  computeCostUsd: number;
  aiTokenCostUsd: number;
  storageCostUsd: number;
  perWorkflowCost: Array<{
    workflowId: string;
    name: string;
    costUsd: number;
    executionsCount: number;
  }>;
}

export interface SystemObservabilityHealth {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  uptimeSeconds: number;
  timestamp: string;
  services: {
    api: { status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; latencyMs: number };
    database: { status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; latencyMs: number; connections: number };
    redis: { status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; latencyMs: number; memoryUsedBytes: number };
    queue: { status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; waitingJobs: number; activeJobs: number; failedJobs: number };
    workers: { status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; activeWorkers: number; concurrency: number };
    websocket: { status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; activeConnections: number };
  };
}

export interface SystemMetricsData {
  timestamp: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  memoryUsedMb: number;
  totalMemoryMb: number;
  apiThroughputRpm: number;
  apiErrorRatePercent: number;
  p95ApiLatencyMs: number;
  queueDepth: number;
  queueThroughputRpm: number;
  workerUtilizationPercent: number;
}

export interface SecurityIntelligenceData {
  workspaceId: string;
  riskScore: number;
  anomalyScore: number;
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  lastScannedAt?: string | undefined;
  apiSecurityScore?: number | undefined;
  queueThreatLevel?: ('LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') | undefined;
  infrastructureAlertsCount?: number | undefined;
  insights: Array<{
    id: string;
    type: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    description: string;
    detectedAt: string;
    recommendation: string;
  }>;
  suspiciousActivities: Array<{
    id: string;
    action: string;
    actor: string;
    ipAddress?: string;
    reason: string;
    timestamp: string;
  }>;
  failedAuthTrends: {
    totalFailedAttempts: number;
    uniqueIpCount: number;
    targetedAccountsCount: number;
    trend: Array<{ timestamp: string; count: number }>;
  };
}

export interface ReportItem {
  id: string;
  name: string;
  type: ReportType;
  status: ReportStatus;
  format: ReportFormat;
  generatedBy: string;
  createdAt: string;
  updatedAt: string;
  fileMetadata?: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl?: string;
  };
  schedule?: {
    frequency: string;
    nextRunAt?: string;
    isActive: boolean;
  };
}

export interface AIOperationsFailureExplanation {
  executionId: string;
  workflowName: string;
  failureSummary: string;
  rootCause: string;
  failingNode?: {
    nodeId: string;
    nodeType: string;
    error: string;
  } | undefined;
  suggestedFixes: string[];
  confidenceScore: number;
}

export interface AIOperationsSystemSummary {
  workspaceId: string;
  summary: string;
  healthGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  keyObservations: string[];
  immediateActions: string[];
  scalingAdvice: string;
}

export interface AIOperationsOptimizationSuggestion {
  workflowId: string;
  workflowName: string;
  estimatedLatencyReductionPercent: number;
  estimatedCostReductionPercent: number;
  suggestions: Array<{
    type: 'PARALLELIZATION' | 'CACHING' | 'RETRY_POLICY' | 'TIMEOUT_TUNING';
    description: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
}

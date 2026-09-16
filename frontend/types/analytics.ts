export interface ExecutionMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface WorkflowAnalytics {
  workflowId: string;
  totalRuns: number;
  successRate: number;
  avgLatencyMs: number;
  statusCounts: Record<string, number>;
}

export interface WorkspaceAnalytics {
  workspaceId: string;
  totalWorkflows: number;
  totalExecutions: number;
  successRate: number;
  activeWorkflows: number;
  recentExecutions?: unknown[];
}

import type { ExecutionStatus } from './execution.js';
import type { StepStatus } from './workflow.js';

export interface WorkflowAnalyticsView {
  workflowId: string;
  workspaceId?: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  failureRate: number;
  replayCount: number;
  averageDurationMs: number;
  lastExecutedAt?: string;
  updatedAt?: string;
}

export interface ExecutionNodeMetric {
  nodeId: string;
  status: StepStatus;
  durationMs: number;
}

export interface ExecutionMetricsView {
  executionId: string;
  workflowId: string;
  workspaceId?: string;
  status: ExecutionStatus;
  durationMs?: number;
  retryCount: number;
  attemptsMade: number;
  nodeCount: number;
  nodes: ExecutionNodeMetric[];
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface WorkspaceAnalyticsView {
  workspaceId: string;
  totalWorkflows: number;
  totalExecutions: number;
  monthlyExecutions: number;
  successRate: number;
  averageExecutionTime: number;
  storageUsed: number;
  updatedAt?: string;
}

export interface AnalyticsRecalculationSummary {
  workflows: number;
  executions: number;
  workspaces: number;
}
import type { WorkflowExecution, DeadLetter } from '@/types/execution';

// Execution console specific types
export interface ExecutionFilters {
  status?: ExecutionStatus[];
  workflowId?: string;
  dateRange?: { start: string; end: string };
  search?: string;
  workspaceId?: string;
}

export type ExecutionStatus =
  | 'PENDING'
  | 'QUEUING'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETRYING';

export interface ExecutionTableRow {
  id: string;
  workflowName: string;
  status: ExecutionStatus;
  duration: number | null;
  startedAt: string;
  finishedAt: string | null;
  retries: number;
  triggeredBy: string;
}

export interface ExecutionDetail {
  execution: WorkflowExecution;
  workflowName: string;
  nodes: ExecutionNode[];
  logs: ExecutionLog[];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface ExecutionNode {
  id: string;
  name: string;
  type: string;
  status: ExecutionStatus;
  startedAt: string | null;
  finishedAt: string | null;
  duration: number | null;
  attempt: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  error: string | null;
}

export interface ExecutionLog {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  nodeId?: string;
}

export interface FailureAnalysisResult {
  rootCause: string;
  affectedNode: string | null;
  suggestedFix?: string;
  resolution?: string;
  confidence: number;
}

export interface WorkerMetrics {
  activeWorkers: number;
  totalWorkers: number;
  queueDepth: {
    executions: number;
    webhooks: number;
    total: number;
  };
  heartbeatStatus?: 'up' | 'down' | 'skipped';
  heartbeatLatencyMs: number;
  scalingRecommendation?: {
    action: 'SCALE_UP' | 'SCALE_DOWN' | 'MAINTAIN';
    reason: string;
  };
  recommendations?: string[];
}
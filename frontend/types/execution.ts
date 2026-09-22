export type ExecutionStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'QUEUING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETRYING';

export interface WorkflowExecution {
  _id: string;
  id?: string;
  executionId?: string;
  workflowId: string;
  workspaceId: string;
  status: ExecutionStatus;
  version: number;
  versionNumber?: number;
  triggerType?: string;
  initialInput?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  replayed?: boolean;
  attemptsMade?: number;
  retryCount?: number;
}

export interface DeadLetter {
  _id: string;
  id?: string;
  executionId: string;
  workflowId: string;
  workspaceId: string;
  failureReason?: string;
  error?: string;
  message?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  attempts?: number;
  attemptsMade?: number;
  retryCount?: number;
}

export interface CreateExecutionPayload {
  initialInput?: Record<string, unknown>;
  triggerType?: string;
  version?: number;
}

export type {
  ExecutionTableRow,
  ExecutionLog,
  ExecutionNode,
  FailureAnalysisResult,
  WorkerMetrics,
} from '@/features/execution-console/types/types';


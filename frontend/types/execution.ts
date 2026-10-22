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

export interface ExecutionHistoryEvent {
  nodeId: string;
  fromStatus: string;
  toStatus: string;
  timestamp: string;
}

/** What the engine recorded for each step, once the run has finished. */
export interface ExecutionResult {
  status: string;
  stepStatuses?: Record<string, string>;
  outputs?: Record<string, unknown>;
  executionHistory?: ExecutionHistoryEvent[];
  errors?: { code: string; message: string; nodeId?: string }[];
}

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
  /** The version of the workflow this run used. */
  workflowVersionId?: string;
  /** The run's input, as the API returns it. */
  input?: Record<string, unknown>;
  initialInput?: Record<string, unknown>;
  output?: Record<string, unknown>;
  result?: ExecutionResult;
  /** The API returns { code, message }; older callers used plain text. */
  error?: string | { code?: string; message?: string };
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


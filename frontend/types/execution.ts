export type ExecutionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETRYING';

export interface WorkflowExecution {
  _id: string;
  id?: string;
  workflowId: string;
  workspaceId: string;
  status: ExecutionStatus;
  version: number;
  triggerType?: string;
  initialInput?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  replayed?: boolean;
}

export interface DeadLetter {
  _id: string;
  id?: string;
  executionId: string;
  workflowId: string;
  workspaceId: string;
  error: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface CreateExecutionPayload {
  initialInput?: Record<string, unknown>;
  triggerType?: string;
  version?: number;
}

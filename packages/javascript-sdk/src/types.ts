export interface ClientConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface TriggerOptions {
  input?: Record<string, unknown>;
  idempotencyKey?: string;
  timeoutMs?: number;
  retryPolicy?: {
    type: 'FIXED' | 'EXPONENTIAL';
    delayMs: number;
    backoffFactor?: number;
    maxRetries: number;
  };
}

export interface WorkflowExecutionResponse {
  executionId: string;
  workflowId: string;
  workflowVersionId?: string;
  versionNumber?: number;
  status: 'QUEUING' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  attemptsMade?: number;
  maxRetries?: number;
  retryCount?: number;
  replayed?: boolean;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebhookEventPayload {
  event: 'WORKFLOW_EXECUTION_STARTED' | 'WORKFLOW_EXECUTION_COMPLETED' | 'WORKFLOW_EXECUTION_FAILED' | 'WORKFLOW_EXECUTION_REPLAYED';
  deliveryId: string;
  timestamp: string;
  data: {
    executionId: string;
    workflowId: string;
    workspaceId: string;
    status: string;
    error?: {
      code: string;
      message: string;
    };
    result?: Record<string, unknown>;
    attempt?: number;
  };
}

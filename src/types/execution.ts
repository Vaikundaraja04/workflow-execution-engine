import type { ExecutionResult } from './workflow.js';

export const EXECUTION_STATUSES = [
  'QUEUING',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type RetryPolicyType = 'FIXED' | 'EXPONENTIAL';

export interface ExecutionRetryPolicy {
  type: RetryPolicyType;
  delayMs: number;
  backoffFactor?: number;
}

export interface StoredExecutionError {
  code: string;
  message: string;
}

export interface ExecutionStatusEvent {
  status: ExecutionStatus;
  timestamp: Date;
  attempt?: number;
}

export interface WorkflowExecutionView {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  versionNumber: number;
  jobId: string;
  idempotencyKey: string;
  status: ExecutionStatus;
  input: Record<string, unknown>;
  result?: ExecutionResult;
  error?: StoredExecutionError;
  attemptsMade: number;
  retryPolicy?: ExecutionRetryPolicy;
  maxRetries: number;
  retryCount: number;
  nextRetryAt?: string;
  timeoutMs?: number;
  parentExecutionId?: string;
  statusHistory: Array<{
    status: ExecutionStatus;
    timestamp: string;
    attempt?: number;
  }>;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeadLetterView {
  executionId: string;
  workflowId?: string;
  failureReason: string;
  message?: string;
  attempts: number;
  failedAt: string;
  createdAt: string;
}
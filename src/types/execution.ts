import type { ExecutionResult } from './workflow.js';

export const EXECUTION_STATUSES = [
  'QUEUING',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

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

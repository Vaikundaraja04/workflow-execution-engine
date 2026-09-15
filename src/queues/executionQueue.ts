export const DEFAULT_EXECUTION_QUEUE_NAME = 'workflow-executions';
export const EXECUTION_JOB_NAME = 'execute-workflow';
export const DEFAULT_EXECUTION_ATTEMPTS = 3;
export const DEFAULT_EXECUTION_BACKOFF_MS = 1_000;

export interface ExecutionJobData {
  executionId: string;
}

export interface ExecutionEnqueueOptions {
  jobId: string;
  attempts: number;
  backoffMs: number;
  backoffType?: 'fixed' | 'exponential';
  delayMs?: number;
}

export interface ExecutionQueue {
  enqueue(data: ExecutionJobData, options: ExecutionEnqueueOptions): Promise<void>;
  close(): Promise<void>;
}

export function createExecutionJobId(executionId: string): string {
  return `execution-${executionId}`;
}

export class UnavailableExecutionQueue implements ExecutionQueue {
  async enqueue(
    _data: ExecutionJobData,
    _options: ExecutionEnqueueOptions,
  ): Promise<void> {
    throw new Error('QUEUE_UNAVAILABLE');
  }

  async close(): Promise<void> {}
}

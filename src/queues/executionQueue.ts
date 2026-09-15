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

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

export interface QueueMetrics {
  name: string;
  isPaused: boolean;
  counts: QueueCounts;
  total: number;
}

export interface ExecutionQueue {
  enqueue(data: ExecutionJobData, options: ExecutionEnqueueOptions): Promise<void>;
  close(): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  isPaused?(): Promise<boolean>;
  getMetrics?(): Promise<QueueMetrics>;
  removeJob?(jobId: string): Promise<boolean>;
  retryJob?(jobId: string): Promise<boolean>;
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

  async pause(): Promise<void> {
    throw new Error('QUEUE_UNAVAILABLE');
  }

  async resume(): Promise<void> {
    throw new Error('QUEUE_UNAVAILABLE');
  }

  async isPaused(): Promise<boolean> {
    return false;
  }

  async getMetrics(): Promise<QueueMetrics> {
    return {
      name: DEFAULT_EXECUTION_QUEUE_NAME,
      isPaused: false,
      counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
      total: 0,
    };
  }

  async removeJob(_jobId: string): Promise<boolean> {
    return false;
  }

  async retryJob(_jobId: string): Promise<boolean> {
    return false;
  }
}

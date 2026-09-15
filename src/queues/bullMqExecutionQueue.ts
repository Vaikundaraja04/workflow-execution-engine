import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type {
  ExecutionEnqueueOptions,
  ExecutionJobData,
  ExecutionQueue,
} from './executionQueue.js';
import {
  DEFAULT_EXECUTION_QUEUE_NAME,
  EXECUTION_JOB_NAME,
} from './executionQueue.js';

export function createQueueConnection(redisUrl: string): ConnectionOptions {
  return {
    url: redisUrl,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    retryStrategy: attempts => attempts > 2 ? null : attempts * 100,
  };
}

export function createWorkerConnection(redisUrl: string): ConnectionOptions {
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}

export class BullMqExecutionQueue implements ExecutionQueue {
  private readonly queue: Queue<ExecutionJobData, void, typeof EXECUTION_JOB_NAME>;

  constructor(redisUrl: string, queueName = DEFAULT_EXECUTION_QUEUE_NAME) {
    this.queue = new Queue<ExecutionJobData, void, typeof EXECUTION_JOB_NAME>(queueName, {
      connection: createQueueConnection(redisUrl),
    });

    this.queue.on('error', error => {
      console.error('Execution queue error:', error.message);
    });
  }

  async enqueue(data: ExecutionJobData, options: ExecutionEnqueueOptions): Promise<void> {
    await this.queue.add(EXECUTION_JOB_NAME, data, {
      jobId: options.jobId,
      attempts: options.attempts,
      backoff: { type: options.backoffType ?? 'exponential', delay: options.backoffMs },
      ...(options.delayMs !== undefined ? { delay: options.delayMs } : {}),
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 1_000 },
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type {
  ExecutionEnqueueOptions,
  ExecutionJobData,
  ExecutionQueue,
  QueueMetrics,
} from './executionQueue.js';
import {
  DEFAULT_EXECUTION_QUEUE_NAME,
  EXECUTION_JOB_NAME,
} from './executionQueue.js';

const RECONNECT_STEP_MS = 200;
const RECONNECT_MAX_DELAY_MS = 5_000;

/**
 * Delay before the next Redis reconnect attempt: 200 ms, 400 ms, ... capped at 5 s.
 * It never gives up. Returning null would close the connection for good, so one
 * short Redis restart (common on Render's free Key Value) would leave the API
 * unable to queue runs until the whole process restarted.
 */
export function redisReconnectDelay(attempts: number): number {
  return Math.min(Math.max(attempts, 1) * RECONNECT_STEP_MS, RECONNECT_MAX_DELAY_MS);
}

export function createQueueConnection(redisUrl: string): ConnectionOptions {
  // Support Redis Cluster via environment variable
  const clusterEnabled = process.env.REDIS_CLUSTER_ENABLED === 'true';
  if (clusterEnabled) {
    const nodes = process.env.REDIS_CLUSTER_NODES?.split(',').map(node => node.trim()).filter(Boolean) ?? [];
    if (nodes.length > 0 && nodes[0]) {
      const [host, port] = nodes[0].split(':');
      return {
        // BullMQ accepts cluster configuration
        host: host || 'localhost',
        port: parseInt(port || '6379', 10),
        maxRetriesPerRequest: 1,
        connectTimeout: 5_000,
        retryStrategy: redisReconnectDelay,
      };
    }
  }
  // Fallback to single node
  return {
    url: redisUrl,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    retryStrategy: redisReconnectDelay,
  };
}

export function createWorkerConnection(redisUrl: string): ConnectionOptions {
  const clusterEnabled = process.env.REDIS_CLUSTER_ENABLED === 'true';
  if (clusterEnabled) {
    const nodes = process.env.REDIS_CLUSTER_NODES?.split(',').map(node => node.trim()).filter(Boolean) ?? [];
    if (nodes.length > 0 && nodes[0]) {
      const [host, port] = nodes[0].split(':');
      return {
        host: host || 'localhost',
        port: parseInt(port || '6379', 10),
        maxRetriesPerRequest: null,
      };
    }
  }
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

  async pause(): Promise<void> {
    await this.queue.pause();
  }

  async resume(): Promise<void> {
    await this.queue.resume();
  }

  async isPaused(): Promise<boolean> {
    return this.queue.isPaused();
  }

  async getMetrics(): Promise<QueueMetrics> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    const isPaused = await this.queue.isPaused();
    return {
      name: this.queue.name,
      isPaused,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        paused: 0,
      },
      total: (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0) + (counts.completed ?? 0),
    };
  }

  async removeJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async retryJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.retry();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async getJobState(jobId: string): Promise<string> {
    return this.queue.getJobState(jobId);
  }

  /**
   * Makes one small read over this queue's own Redis connection, the one used to
   * add jobs. False when that connection cannot answer within the timeout.
   */
  async ping(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.queue.getJobCounts('waiting'),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('PING_TIMEOUT')), timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async waitUntilReady(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

import { Queue } from 'bullmq';
import type {
  WebhookEnqueueOptions,
  WebhookJobData,
  WebhookQueue,
} from './webhookQueue.js';
import {
  DEFAULT_WEBHOOK_QUEUE_NAME,
  WEBHOOK_JOB_NAME,
} from './webhookQueue.js';
import type { QueueMetrics } from './executionQueue.js';
import { createQueueConnection } from './bullMqExecutionQueue.js';

export class BullMqWebhookQueue implements WebhookQueue {
  private readonly queue: Queue<WebhookJobData, void, typeof WEBHOOK_JOB_NAME>;

  constructor(redisUrl: string, queueName = DEFAULT_WEBHOOK_QUEUE_NAME) {
    this.queue = new Queue<WebhookJobData, void, typeof WEBHOOK_JOB_NAME>(queueName, {
      connection: createQueueConnection(redisUrl),
    });

    this.queue.on('error', error => {
      console.error('Webhook queue error:', error.message);
    });
  }

  async enqueue(data: WebhookJobData, options: WebhookEnqueueOptions): Promise<void> {
    await this.queue.add(WEBHOOK_JOB_NAME, data, {
      jobId: options.jobId,
      attempts: options.attempts,
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

  async waitUntilReady(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

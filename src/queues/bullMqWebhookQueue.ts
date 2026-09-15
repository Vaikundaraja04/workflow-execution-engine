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

  async waitUntilReady(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

import type { QueueMetrics } from './executionQueue.js';

export const DEFAULT_WEBHOOK_QUEUE_NAME = 'webhook-delivery';
export const WEBHOOK_JOB_NAME = 'deliver-webhook';

export interface WebhookJobData {
  deliveryId: string;
}

export interface WebhookEnqueueOptions {
  jobId: string;
  attempts: number;
  backoffMs: number;
  delayMs?: number;
}

export interface WebhookQueue {
  enqueue(data: WebhookJobData, options: WebhookEnqueueOptions): Promise<void>;
  close(): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  isPaused?(): Promise<boolean>;
  getMetrics?(): Promise<QueueMetrics>;
  removeJob?(jobId: string): Promise<boolean>;
}

export function createWebhookJobId(deliveryId: string): string {
  return `webhook-delivery-${deliveryId}`;
}

export class UnavailableWebhookQueue implements WebhookQueue {
  async enqueue(
    _data: WebhookJobData,
    _options: WebhookEnqueueOptions,
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
      name: DEFAULT_WEBHOOK_QUEUE_NAME,
      isPaused: false,
      counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
      total: 0,
    };
  }

  async removeJob(_jobId: string): Promise<boolean> {
    return false;
  }
}

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
}

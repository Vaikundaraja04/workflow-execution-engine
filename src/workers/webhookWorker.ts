import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { WebhookJobData } from '../queues/webhookQueue.js';
import {
  DEFAULT_WEBHOOK_QUEUE_NAME,
  WEBHOOK_JOB_NAME,
} from '../queues/webhookQueue.js';
import { createWorkerConnection } from '../queues/bullMqExecutionQueue.js';
import { getWebhookDeliveryById, getWebhookSecret, updateWebhookDeliveryStatus } from '../services/webhookService.js';
import { getWebhook, signPayload } from '../services/webhookService.js';
import { createAuditLog } from '../services/auditService.js';

export interface WebhookWorkerOptions {
  queueName?: string;
  concurrency?: number;
  httpTimeout?: number;
}

const RETRY_DELAYS = [10000, 30000, 120000, 600000, 1800000]; // 10s, 30s, 2m, 10m, 30m

function getRetryDelay(attemptNumber: number): number {
  const index = Math.min(attemptNumber - 1, RETRY_DELAYS.length - 1);
  return RETRY_DELAYS[index] ?? 1800000;
}

async function deliverWebhook(
  deliveryId: string,
  attemptNumber: number,
  httpTimeout: number,
): Promise<void> {
  const startTime = Date.now();

  // Load the delivery
  const delivery = await getWebhookDeliveryById(deliveryId);

  if (delivery.status === 'DELIVERED') {
    // Already delivered, skip
    return;
  }

  // Load the webhook
  const webhook = await getWebhook(delivery.webhookId.toString(), delivery.workspaceId.toString());

  if (webhook.status !== 'ACTIVE') {
    // Webhook is not active, mark delivery as failed
    await updateWebhookDeliveryStatus(deliveryId, delivery.workspaceId.toString(), {
      status: 'FAILED',
      attempts: attemptNumber,
      responseCode: 0,
      responseBody: 'Webhook is not active',
      durationMs: Date.now() - startTime,
    });
    return;
  }

  // Get the webhook secret
  const secret = await getWebhookSecret(webhook._id.toString(), webhook.workspaceId.toString());

  // Parse the payload
  const rawPayload = delivery.payload;
  const payload = JSON.parse(rawPayload);

  // Generate signature
  const signature = signPayload(rawPayload, secret);

  // Set status to RETRYING if this is a retry
  if (attemptNumber > 1) {
    await updateWebhookDeliveryStatus(deliveryId, delivery.workspaceId.toString(), {
      status: 'RETRYING',
      attempts: attemptNumber,
    });
  }

  // Make the HTTP request
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), httpTimeout);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workflow-Event': delivery.event,
        'X-Workflow-Delivery-ID': deliveryId,
        'X-Workflow-Signature': signature,
      },
      body: rawPayload,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseBody = await response.text();
    const durationMs = Date.now() - startTime;

    if (response.ok) {
      // Success
      await updateWebhookDeliveryStatus(deliveryId, delivery.workspaceId.toString(), {
        status: 'DELIVERED',
        attempts: attemptNumber,
        responseCode: response.status,
        responseBody: responseBody.substring(0, 1000), // Limit response body size
        durationMs,
        deliveredAt: new Date(),
      });
    } else {
      // HTTP error
      if (attemptNumber >= delivery.maxAttempts) {
        // Max attempts reached, mark as failed
        await updateWebhookDeliveryStatus(deliveryId, delivery.workspaceId.toString(), {
          status: 'FAILED',
          attempts: attemptNumber,
          responseCode: response.status,
          responseBody: responseBody.substring(0, 1000),
          durationMs,
        });

        await createAuditLog({
          action: 'WEBHOOK_DELIVERY_FAILED',
          workspaceId: delivery.workspaceId.toString(),
          resource: 'webhook_delivery',
          resourceId: deliveryId,
          metadata: {
            webhookId: webhook._id.toString(),
            deliveryId,
            event: delivery.event,
            attempts: attemptNumber,
            responseCode: response.status,
          },
        });
      } else {
        // Schedule retry
        const nextRetryAt = new Date(Date.now() + getRetryDelay(attemptNumber));
        await updateWebhookDeliveryStatus(deliveryId, delivery.workspaceId.toString(), {
          status: 'PENDING',
          attempts: attemptNumber,
          nextRetryAt,
          responseCode: response.status,
          responseBody: responseBody.substring(0, 1000),
          durationMs,
        });

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (attemptNumber >= delivery.maxAttempts) {
      // Max attempts reached, mark as failed
      await updateWebhookDeliveryStatus(deliveryId, delivery.workspaceId.toString(), {
        status: 'FAILED',
        attempts: attemptNumber,
        responseCode: 0,
        responseBody: errorMessage.substring(0, 1000),
        durationMs,
      });

      await createAuditLog({
        action: 'WEBHOOK_DELIVERY_FAILED',
        workspaceId: delivery.workspaceId.toString(),
        resource: 'webhook_delivery',
        resourceId: deliveryId,
        metadata: {
          webhookId: webhook._id.toString(),
          deliveryId,
          event: delivery.event,
          attempts: attemptNumber,
          error: errorMessage,
        },
      });
    } else {
      // Schedule retry
      const nextRetryAt = new Date(Date.now() + getRetryDelay(attemptNumber));
      await updateWebhookDeliveryStatus(deliveryId, delivery.workspaceId.toString(), {
        status: 'PENDING',
        attempts: attemptNumber,
        nextRetryAt,
        responseCode: 0,
        responseBody: errorMessage.substring(0, 1000),
        durationMs,
      });

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  }
}

function getAttemptNumber(job: Job<WebhookJobData>): number {
  return Math.max(job.attemptsStarted, job.attemptsMade + 1, 1);
}

export function createWebhookWorker(
  redisUrl: string,
  options: WebhookWorkerOptions = {},
) {
  const worker = new Worker<WebhookJobData, void, typeof WEBHOOK_JOB_NAME>(
    options.queueName ?? DEFAULT_WEBHOOK_QUEUE_NAME,
    async job => {
      if (job.name !== WEBHOOK_JOB_NAME) {
        throw new Error('UNKNOWN_WEBHOOK_JOB');
      }

      await deliverWebhook(
        job.data.deliveryId,
        getAttemptNumber(job),
        options.httpTimeout ?? 30000,
      );
    },
    {
      connection: createWorkerConnection(redisUrl),
      concurrency: options.concurrency ?? 10,
      maxStalledCount: 2,
    },
  );

  worker.on('error', error => {
    console.error('Webhook worker error:', error.message);
  });

  worker.on('failed', async (job, error) => {
    if (!job) return;
    console.error(`Webhook delivery ${job.data.deliveryId} failed:`, error.message);

    // Audit the retry
    try {
      const delivery = await getWebhookDeliveryById(job.data.deliveryId);
      await createAuditLog({
        action: 'WEBHOOK_DELIVERY_RETRIED',
        workspaceId: delivery.workspaceId.toString(),
        resource: 'webhook_delivery',
        resourceId: job.data.deliveryId,
        metadata: {
          deliveryId: job.data.deliveryId,
          event: delivery.event,
          attempt: getAttemptNumber(job),
        },
      });
    } catch (auditError) {
      console.error('Failed to audit webhook retry:', auditError);
    }
  });

  return worker;
}

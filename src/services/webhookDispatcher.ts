import { Types } from 'mongoose';
import { WebhookModel } from '../models/WebhookModel.js';
import type { IWebhook, WebhookEvent } from '../models/WebhookModel.js';
import type { IWorkflowExecution } from '../models/WorkflowExecutionModel.js';
import { createWebhookDelivery } from './webhookService.js';
import type { WebhookQueue } from '../queues/webhookQueue.js';
import { createWebhookJobId } from '../queues/webhookQueue.js';

export interface WebhookPayload {
  [key: string]: unknown;
  event: WebhookEvent;
  timestamp: string;
  workflowId: string;
  executionId: string;
  workspaceId: string;
  versionNumber: number;
  status: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

function buildPayload(execution: IWorkflowExecution, event: WebhookEvent): WebhookPayload {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    workflowId: execution.workflowId.toString(),
    executionId: execution._id.toString(),
    workspaceId: execution.workspaceId?.toString() ?? '',
    versionNumber: execution.versionNumber,
    status: execution.status,
    input: execution.input,
    createdAt: execution.createdAt.toISOString(),
  };

  if (execution.result) {
    payload.result = execution.result;
  }

  if (execution.error) {
    payload.error = {
      code: execution.error.code,
      message: execution.error.message,
    };
  }

  if (execution.startedAt) {
    payload.startedAt = execution.startedAt.toISOString();
  }

  if (execution.finishedAt) {
    payload.finishedAt = execution.finishedAt.toISOString();
  }

  return payload;
}

export async function dispatchWebhookEvent(
  queue: WebhookQueue,
  execution: IWorkflowExecution,
  event: WebhookEvent,
): Promise<void> {
  if (!execution.workspaceId) {
    return;
  }

  // Find all active webhooks for this workspace that subscribe to this event
  const webhooks: IWebhook[] = await WebhookModel.find({
    workspaceId: new Types.ObjectId(execution.workspaceId),
    status: 'ACTIVE',
    events: event,
  });

  if (webhooks.length === 0) {
    return;
  }

  // Build the payload
  const payload = buildPayload(execution, event);

  // Create a delivery job for each webhook
  for (const webhook of webhooks) {
    try {
      const delivery = await createWebhookDelivery(
        webhook._id.toString(),
        webhook.workspaceId.toString(),
        event,
        payload,
      );

      // Enqueue the delivery job
      await queue.enqueue(
        { deliveryId: delivery._id.toString() },
        {
          jobId: createWebhookJobId(delivery._id.toString()),
          attempts: delivery.maxAttempts,
          backoffMs: 10000, // Initial backoff: 10 seconds
        },
      );
    } catch (error) {
      console.error(`Failed to create webhook delivery for webhook ${webhook._id.toString()}:`, error);
    }
  }
}

export async function dispatchExecutionStarted(
  queue: WebhookQueue,
  execution: IWorkflowExecution,
): Promise<void> {
  await dispatchWebhookEvent(queue, execution, 'WORKFLOW_EXECUTION_STARTED');
}

export async function dispatchExecutionCompleted(
  queue: WebhookQueue,
  execution: IWorkflowExecution,
): Promise<void> {
  await dispatchWebhookEvent(queue, execution, 'WORKFLOW_EXECUTION_COMPLETED');
}

export async function dispatchExecutionFailed(
  queue: WebhookQueue,
  execution: IWorkflowExecution,
): Promise<void> {
  await dispatchWebhookEvent(queue, execution, 'WORKFLOW_EXECUTION_FAILED');
}

export async function dispatchExecutionReplayed(
  queue: WebhookQueue,
  execution: IWorkflowExecution,
): Promise<void> {
  await dispatchWebhookEvent(queue, execution, 'WORKFLOW_EXECUTION_REPLAYED');
}

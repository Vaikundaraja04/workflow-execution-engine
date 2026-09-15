import type { ExecutionQueue, QueueMetrics } from '../queues/executionQueue.js';
import type { WebhookQueue } from '../queues/webhookQueue.js';

export interface QueueManagementService {
  getExecutionQueueMetrics(): Promise<QueueMetrics>;
  getWebhookQueueMetrics(): Promise<QueueMetrics>;
  pauseExecutionQueue(): Promise<void>;
  resumeExecutionQueue(): Promise<void>;
  isExecutionQueuePaused(): Promise<boolean>;
  pauseWebhookQueue(): Promise<void>;
  resumeWebhookQueue(): Promise<void>;
  isWebhookQueuePaused(): Promise<boolean>;
  removeExecutionJob(jobId: string): Promise<boolean>;
  retryExecutionJob(jobId: string): Promise<boolean>;
  removeWebhookJob(jobId: string): Promise<boolean>;
}

export function createQueueManagementService(
  executionQueue: ExecutionQueue,
  webhookQueue: WebhookQueue,
): QueueManagementService {
  return {
    async getExecutionQueueMetrics() {
      if (executionQueue.getMetrics) {
        return executionQueue.getMetrics();
      }
      return {
        name: 'workflow-executions',
        isPaused: false,
        counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
        total: 0,
      };
    },

    async getWebhookQueueMetrics() {
      if (webhookQueue.getMetrics) {
        return webhookQueue.getMetrics();
      }
      return {
        name: 'webhook-delivery',
        isPaused: false,
        counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
        total: 0,
      };
    },

    async pauseExecutionQueue() {
      if (executionQueue.pause) {
        await executionQueue.pause();
      }
    },

    async resumeExecutionQueue() {
      if (executionQueue.resume) {
        await executionQueue.resume();
      }
    },

    async isExecutionQueuePaused() {
      if (executionQueue.isPaused) {
        return executionQueue.isPaused();
      }
      return false;
    },

    async pauseWebhookQueue() {
      if (webhookQueue.pause) {
        await webhookQueue.pause();
      }
    },

    async resumeWebhookQueue() {
      if (webhookQueue.resume) {
        await webhookQueue.resume();
      }
    },

    async isWebhookQueuePaused() {
      if (webhookQueue.isPaused) {
        return webhookQueue.isPaused();
      }
      return false;
    },

    async removeExecutionJob(jobId) {
      return executionQueue.removeJob ? executionQueue.removeJob(jobId) : false;
    },

    async retryExecutionJob(jobId) {
      return executionQueue.retryJob ? executionQueue.retryJob(jobId) : false;
    },

    async removeWebhookJob(jobId) {
      return webhookQueue.removeJob ? webhookQueue.removeJob(jobId) : false;
    },
  };
}
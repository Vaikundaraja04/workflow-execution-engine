import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { WorkflowExecutor } from '../services/executionService.js';
import {
  markExecutionFailed,
  runExecutionAttempt,
} from '../services/executionService.js';
import type { ExecutionJobData } from '../queues/executionQueue.js';
import {
  DEFAULT_EXECUTION_ATTEMPTS,
  DEFAULT_EXECUTION_QUEUE_NAME,
  EXECUTION_JOB_NAME,
} from '../queues/executionQueue.js';
import { createWorkerConnection } from '../queues/bullMqExecutionQueue.js';

export interface ExecutionWorkerOptions {
  queueName?: string;
  concurrency?: number;
  executor?: WorkflowExecutor;
  attemptRunner?: (
    executionId: string,
    attemptNumber: number,
    maxAttempts: number,
    executor?: WorkflowExecutor,
  ) => Promise<void>;
}

function getMaximumAttempts(job: Job<ExecutionJobData>): number {
  return typeof job.opts.attempts === 'number'
    ? job.opts.attempts
    : DEFAULT_EXECUTION_ATTEMPTS;
}

function getAttemptNumber(job: Job<ExecutionJobData>): number {
  return Math.max(job.attemptsStarted, job.attemptsMade + 1, 1);
}

export function createExecutionWorker(
  redisUrl: string,
  options: ExecutionWorkerOptions = {},
) {
  const worker = new Worker<ExecutionJobData, void, typeof EXECUTION_JOB_NAME>(
    options.queueName ?? DEFAULT_EXECUTION_QUEUE_NAME,
    async job => {
      if (job.name !== EXECUTION_JOB_NAME) {
        throw new Error('UNKNOWN_EXECUTION_JOB');
      }

      const attemptRunner = options.attemptRunner ?? (async (
        executionId: string,
        attemptNumber: number,
        maxAttempts: number,
        executor?: WorkflowExecutor,
      ) => {
        await runExecutionAttempt(executionId, attemptNumber, maxAttempts, executor);
      });
      await attemptRunner(
        job.data.executionId,
        getAttemptNumber(job),
        getMaximumAttempts(job),
        options.executor,
      );
    },
    {
      connection: createWorkerConnection(redisUrl),
      concurrency: options.concurrency ?? 5,
      maxStalledCount: 2,
    },
  );

  worker.on('error', error => {
    console.error('Execution worker error:', error.message);
  });

  worker.on('failed', (job, error) => {
    if (!job) return;
    const exhausted = job.attemptsMade >= getMaximumAttempts(job);
    const stalled = error.message.toLowerCase().includes('stalled more than');
    if (!exhausted && !stalled) return;

    const failure = stalled
      ? { code: 'WORKER_STALLED', message: 'Execution worker stalled repeatedly' }
      : { code: 'EXECUTION_FAILED', message: 'Workflow execution failed after all retry attempts' };

    void markExecutionFailed(
      job.data.executionId,
      failure,
      getAttemptNumber(job),
    ).catch(markError => {
      const message = markError instanceof Error ? markError.message : 'Unknown persistence error';
      console.error('Could not persist terminal execution failure:', message);
    });
  });

  return worker;
}

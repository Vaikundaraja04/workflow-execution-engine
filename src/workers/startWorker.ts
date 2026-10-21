import { pathToFileURL } from 'node:url';
import { loadEnv } from '../config/env.js';
import type { Env } from '../config/env.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import { createExecutionWorker } from './executionWorker.js';
import { createWebhookWorker } from './webhookWorker.js';
import { BullMqExecutionQueue } from '../queues/bullMqExecutionQueue.js';
import { BullMqWebhookQueue } from '../queues/bullMqWebhookQueue.js';
import {
  configureWebhookDispatch,
  DEFAULT_ORPHAN_GRACE_MS,
  recoverOrphanedExecutions,
  recoverPendingExecutions,
} from '../services/executionService.js';
import { startWorkerHeartbeat } from '../observability/workerHeartbeat.js';
import { logger } from '../observability/logger.js';

export const DEFAULT_ORPHAN_SWEEP_INTERVAL_MS = 60_000;

export interface WorkerRuntime {
  /** True while both queue workers are running. */
  isRunning: () => boolean;
  /** Runs one sweep for runs whose queue job was lost. */
  sweepOrphans: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface StartWorkersOptions {
  env?: Env;
  /** Re-queue runs left in QUEUING by a crash before the workers start (default true). */
  recoverPending?: boolean;
  /** How often to look for runs whose queue job was lost; 0 turns the sweep off. */
  orphanSweepIntervalMs?: number;
  /** How long a run must sit untouched before the sweep checks its job. */
  orphanGraceMs?: number;
}

function readNonNegativeMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/**
 * Starts the execution and webhook workers, the heartbeat and the lost-job sweep.
 * Used by this file's own entry point (separate worker process) and by src/main.ts
 * (API and workers in one process, as on Render's free plan).
 */
export async function startWorkers(options: StartWorkersOptions = {}): Promise<WorkerRuntime> {
  const env = options.env ?? loadEnv();
  const creationOptions = {
    attempts: env.EXECUTION_ATTEMPTS,
    backoffMs: env.EXECUTION_BACKOFF_MS,
    timeoutMs: env.EXECUTION_TIMEOUT_MS,
  };

  await connectDB(env.MONGODB_URI);
  const recoveryQueue = new BullMqExecutionQueue(env.REDIS_URL);
  await recoveryQueue.waitUntilReady();
  if (options.recoverPending !== false) {
    const recovery = await recoverPendingExecutions(recoveryQueue, creationOptions);
    if (recovery.examined > 0) {
      console.log(`Recovered ${recovery.recovered} pending executions`);
    }
  }

  const worker = createExecutionWorker(env.REDIS_URL, {
    concurrency: env.WORKER_CONCURRENCY,
  });
  await worker.waitUntilReady();
  const webhookDispatchQueue = new BullMqWebhookQueue(env.REDIS_URL);
  await webhookDispatchQueue.waitUntilReady();
  configureWebhookDispatch(webhookDispatchQueue);
  const webhookWorker = createWebhookWorker(env.REDIS_URL);
  await webhookWorker.waitUntilReady();
  const heartbeat = startWorkerHeartbeat(env.REDIS_URL);

  const orphanGraceMs = options.orphanGraceMs ?? readNonNegativeMs('ORPHAN_GRACE_MS', DEFAULT_ORPHAN_GRACE_MS);
  let sweeping = false;
  const sweepOrphans = async (): Promise<void> => {
    if (sweeping) return;
    sweeping = true;
    try {
      const swept = await recoverOrphanedExecutions(recoveryQueue, { ...creationOptions, graceMs: orphanGraceMs });
      if (swept.requeued > 0 || swept.failed > 0) {
        logger.warn('orphaned_executions_recovered', { ...swept });
      }
    } catch (error) {
      logger.warn('orphaned_execution_sweep_failed', {
        errorMessage: error instanceof Error ? error.message : 'unknown error',
      });
    } finally {
      sweeping = false;
    }
  };
  const sweepIntervalMs = options.orphanSweepIntervalMs
    ?? readNonNegativeMs('ORPHAN_SWEEP_INTERVAL_MS', DEFAULT_ORPHAN_SWEEP_INTERVAL_MS);
  const sweepTimer = sweepIntervalMs > 0 ? setInterval(() => void sweepOrphans(), sweepIntervalMs) : undefined;
  sweepTimer?.unref();
  void sweepOrphans();

  logger.info('execution_worker_ready', { concurrency: env.WORKER_CONCURRENCY });

  let stopped = false;
  return {
    isRunning: () => !stopped && worker.isRunning() && webhookWorker.isRunning(),
    sweepOrphans,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (sweepTimer) clearInterval(sweepTimer);
      await heartbeat.stop();
      await worker.close();
      await webhookWorker.close();
      await webhookDispatchQueue.close();
      await recoveryQueue.close();
    },
  };
}

let isShuttingDown = false;

async function runWorkerProcess(): Promise<void> {
  try {
    const runtime = await startWorkers();

    const shutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, shutting down worker gracefully...`);
      try {
        await runtime.stop();
        await disconnectDB();
        process.exit(0);
      } catch (error) {
        console.error('Error during worker shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start execution worker', error);
    await disconnectDB();
    process.exit(1);
  }
}

const isEntryPoint = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void runWorkerProcess();
}

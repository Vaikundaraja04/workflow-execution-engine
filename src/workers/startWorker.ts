import { loadEnv } from '../config/env.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import { createExecutionWorker } from './executionWorker.js';
import { BullMqExecutionQueue } from '../queues/bullMqExecutionQueue.js';
import { recoverPendingExecutions } from '../services/executionService.js';
import { startWorkerHeartbeat } from '../observability/workerHeartbeat.js';
import { logger } from '../observability/logger.js';

const env = loadEnv();
let isShuttingDown = false;

async function startWorker(): Promise<void> {
  try {
    await connectDB(env.MONGODB_URI);
    const recoveryQueue = new BullMqExecutionQueue(env.REDIS_URL);
    await recoveryQueue.waitUntilReady();
    const recovery = await recoverPendingExecutions(recoveryQueue, {
      attempts: env.EXECUTION_ATTEMPTS,
      backoffMs: env.EXECUTION_BACKOFF_MS,
      timeoutMs: env.EXECUTION_TIMEOUT_MS,
    });
    await recoveryQueue.close();
    if (recovery.examined > 0) {
      console.log(`Recovered ${recovery.recovered} pending executions`);
    }
    const worker = createExecutionWorker(env.REDIS_URL, {
      concurrency: env.WORKER_CONCURRENCY,
    });
    await worker.waitUntilReady();
    const heartbeat = startWorkerHeartbeat(env.REDIS_URL);
    logger.info('execution_worker_ready', { concurrency: env.WORKER_CONCURRENCY });

    const shutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, shutting down worker gracefully...`);
      await heartbeat.stop();
      await worker.close();
      await disconnectDB();
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start execution worker', error);
    await disconnectDB();
    process.exit(1);
  }
}

void startWorker();

export {};

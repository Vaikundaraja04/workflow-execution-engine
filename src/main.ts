/**
 * Runs the API and the queue workers in one Node process.
 *
 * Use this on small hosts such as Render's free plan, where background workers are
 * not available. Running both in one process means:
 * - a stopped worker makes /health return 503, so the host restarts the instance
 *   (before, a worker started with "&" could die unnoticed while the API stayed up);
 * - one process uses less memory than two on a 512 MB instance.
 *
 * Larger deployments can still run the API (dist/api/server.js) and the workers
 * (dist/workers/startWorker.js) as separate services.
 */
import { loadEnv } from './config/env.js';
import { disconnectDB } from './db/connection.js';
import { startApi } from './api/server.js';
import type { ApiRuntime } from './api/server.js';
import { startWorkers } from './workers/startWorker.js';
import type { WorkerRuntime } from './workers/startWorker.js';

let shuttingDown = false;

async function main(): Promise<void> {
  const env = loadEnv();
  let workers: WorkerRuntime | undefined;
  let api: ApiRuntime | undefined;

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down API and workers...`);
    let code = exitCode;
    try {
      // Workers first: runs that finish while they drain still send their webhooks
      // through the API's queue connection, which is closed after them.
      await workers?.stop();
      await api?.stop();
      await disconnectDB();
    } catch (error) {
      console.error('Error during shutdown', error);
      code = 1;
    } finally {
      process.exit(code);
    }
  };

  try {
    workers = await startWorkers({ env });
    // The workers already re-queued runs a crash left behind; the API need not repeat it.
    api = await startApi({ env, recoverPending: false, inlineWorkers: workers });
  } catch (error) {
    console.error('Failed to start the API and workers', error);
    await shutdown('startup failure', 1);
    return;
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();

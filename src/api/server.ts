import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import { loadEnv } from '../config/env.js';
import type { Env } from '../config/env.js';
import { BullMqExecutionQueue } from '../queues/bullMqExecutionQueue.js';
import { BullMqWebhookQueue } from '../queues/bullMqWebhookQueue.js';
import { configureWebhookDispatch, recoverPendingExecutions } from '../services/executionService.js';
import { initializeSocketIO, closeSocketIO } from '../realtime/socketServer.js';
import { observabilityCollectorService } from '../services/observabilityCollectorService.js';
import { continuousReadinessService } from '../services/continuousReadinessService.js';
import { subscriptionLifecycleService } from '../services/subscriptionLifecycleService.js';
import { demoWorkspaceService } from '../services/demoWorkspaceService.js';
import type { HealthCheckResult } from '../observability/health.js';

export interface InlineWorkers {
  isRunning: () => boolean;
}

export interface StartApiOptions {
  env?: Env;
  /** Re-queue runs left in QUEUING by a crash before serving traffic (default true). */
  recoverPending?: boolean;
  /**
   * Workers running in this same process (src/main.ts). When set, /health reports
   * 503 if they stop, so the host restarts the instance instead of leaving runs queued.
   */
  inlineWorkers?: InlineWorkers;
}

export interface ApiRuntime {
  server: Server;
  /** Stops accepting requests and closes the API's connections (not the database). */
  stop: () => Promise<void>;
}

function readPositiveInt(name: string): number | undefined {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
}

function inlineWorkerCheck(workers: InlineWorkers): () => Promise<HealthCheckResult> {
  return async () => (workers.isRunning()
    ? { status: 'up', latencyMs: 0 }
    : { status: 'down', latencyMs: 0, detail: 'in-process workers stopped' });
}

export async function startApi(options: StartApiOptions = {}): Promise<ApiRuntime> {
  const env = options.env ?? loadEnv();
  let queue: BullMqExecutionQueue | undefined;
  let webhookQueue: BullMqWebhookQueue | undefined;
  try {
    await connectDB(env.MONGODB_URI);
    queue = new BullMqExecutionQueue(env.REDIS_URL);
    await queue.waitUntilReady();
    webhookQueue = new BullMqWebhookQueue(env.REDIS_URL);
    await webhookQueue.waitUntilReady();
    configureWebhookDispatch(webhookQueue);
    if (options.recoverPending !== false) {
      const recovery = await recoverPendingExecutions(queue, {
        attempts: env.EXECUTION_ATTEMPTS,
        backoffMs: env.EXECUTION_BACKOFF_MS,
        timeoutMs: env.EXECUTION_TIMEOUT_MS,
      });
      if (recovery.examined > 0) {
        console.log(`Recovered ${recovery.recovered} pending executions`);
      }
    }
  } catch (error) {
    await queue?.close();
    await webhookQueue?.close();
    throw error;
  }

  const executionQueue = queue;
  const authLoginLimit = readPositiveInt('AUTH_LOGIN_LIMIT');
  const authRefreshLimit = readPositiveInt('AUTH_REFRESH_LIMIT');
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(origin => origin.length > 0);
  const app = createApp({
    executionQueue,
    webhookQueue,
    executionCreationOptions: {
      attempts: env.EXECUTION_ATTEMPTS,
      backoffMs: env.EXECUTION_BACKOFF_MS,
      timeoutMs: env.EXECUTION_TIMEOUT_MS,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
    },
    authRateLimit: {
      ...(authLoginLimit !== undefined ? { loginLimit: authLoginLimit } : {}),
      ...(authRefreshLimit !== undefined ? { refreshLimit: authRefreshLimit } : {}),
    },
    corsOrigins,
    health: {
      redisUrl: env.REDIS_URL,
      // Check the connection the API really uses to queue runs, not a fresh one.
      queue: executionQueue,
      ...(options.inlineWorkers
        ? { checks: { worker: inlineWorkerCheck(options.inlineWorkers) }, requireWorker: true }
        : {}),
    },
    auth: {
      jwtSecret: env.AUTH_JWT_SECRET,
      accessTtl: env.AUTH_ACCESS_TTL,
      refreshTtl: env.AUTH_REFRESH_TTL,
    },
  });
  const server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });

  initializeSocketIO(server, {
    auth: {
      jwtSecret: env.AUTH_JWT_SECRET,
      accessTtl: env.AUTH_ACCESS_TTL,
      refreshTtl: env.AUTH_REFRESH_TTL,
    },
    redisUrl: env.REDIS_URL,
    corsOrigins,
  });

  observabilityCollectorService.configure({ redisUrl: env.REDIS_URL, executionQueue });
  const configuredIntervalMs = Number(process.env.METRICS_RECORD_INTERVAL_MS);
  const metricsIntervalMs = Number.isFinite(configuredIntervalMs) && configuredIntervalMs >= 10_000
    ? Math.floor(configuredIntervalMs)
    : 60_000;
  const metricsRecorder = setInterval(() => {
    void observabilityCollectorService.recordSnapshot().catch((error) => {
      console.warn('Failed to record observability snapshot', error);
    });
  }, metricsIntervalMs);
  metricsRecorder.unref();
  await observabilityCollectorService.recordSnapshot().catch((error) => {
    console.warn('Failed to record initial observability snapshot', error);
  });
  const scanScheduler = continuousReadinessService.startScheduler();
  if (scanScheduler.started) {
    console.log(`Continuous readiness scans enabled every ${scanScheduler.intervalMs} ms`);
  }
  const subscriptionSweepScheduler = subscriptionLifecycleService.startScheduler();
  if (subscriptionSweepScheduler.started) {
    console.log(`Subscription lifecycle sweeps enabled every ${subscriptionSweepScheduler.intervalMs} ms`);
  }
  const demoExpiryScheduler = demoWorkspaceService.startScheduler();
  if (demoExpiryScheduler.started) {
    console.log(`Demo sandbox expiry sweeps enabled every ${demoExpiryScheduler.intervalMs} ms`);
  }

  let stopped = false;
  return {
    server,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(metricsRecorder);
      continuousReadinessService.stopScheduler();
      subscriptionLifecycleService.stopScheduler();
      demoWorkspaceService.stopScheduler();
      // Socket.IO disconnects realtime clients and also closes the HTTP server.
      await closeSocketIO();
      await new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await executionQueue.close();
      await webhookQueue?.close();
    },
  };
}

let isShuttingDown = false;

async function runApiProcess(): Promise<void> {
  try {
    const runtime = await startApi();

    const shutdown = (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, shutting down gracefully...`);
      void runtime.stop()
        .then(() => disconnectDB())
        .then(() => process.exit(0), (error: unknown) => {
          console.error('Error during shutdown', error);
          process.exit(1);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start server', err);
    await disconnectDB();
    process.exit(1);
  }
}

const isEntryPoint = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void runApiProcess();
}

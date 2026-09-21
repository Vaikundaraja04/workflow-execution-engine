import { createApp } from './app.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import { loadEnv } from '../config/env.js';
import { BullMqExecutionQueue } from '../queues/bullMqExecutionQueue.js';
import { recoverPendingExecutions } from '../services/executionService.js';
import { initializeSocketIO, closeSocketIO } from '../realtime/socketServer.js';
import { observabilityCollectorService } from '../services/observabilityCollectorService.js';
import { continuousReadinessService } from '../services/continuousReadinessService.js';

const env = loadEnv();

let isShuttingDown = false;

function readPositiveInt(name: string): number | undefined {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
}

async function startServer() {
  let queue: BullMqExecutionQueue | undefined;
  try {
    await connectDB(env.MONGODB_URI);
    queue = new BullMqExecutionQueue(env.REDIS_URL);
    await queue.waitUntilReady();
    const recovery = await recoverPendingExecutions(queue, {
      attempts: env.EXECUTION_ATTEMPTS,
      backoffMs: env.EXECUTION_BACKOFF_MS,
      timeoutMs: env.EXECUTION_TIMEOUT_MS,
    });
    if (recovery.examined > 0) {
      console.log(`Recovered ${recovery.recovered} pending executions`);
    }
    const authLoginLimit = readPositiveInt('AUTH_LOGIN_LIMIT');
    const authRefreshLimit = readPositiveInt('AUTH_REFRESH_LIMIT');
    const app = createApp({
      executionQueue: queue,
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
      corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(origin => origin.length > 0),
      health: { redisUrl: env.REDIS_URL },
      auth: {
        jwtSecret: env.AUTH_JWT_SECRET,
        accessTtl: env.AUTH_ACCESS_TTL,
        refreshTtl: env.AUTH_REFRESH_TTL,
      },
    });
    const server = app.listen(env.PORT, () => {
      console.log(`Server running on port ${env.PORT}`);
    });

    // Initialize Socket.IO server
    initializeSocketIO(server, {
      auth: {
        jwtSecret: env.AUTH_JWT_SECRET,
        accessTtl: env.AUTH_ACCESS_TTL,
        refreshTtl: env.AUTH_REFRESH_TTL,
      },
      redisUrl: env.REDIS_URL,
      corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(origin => origin.length > 0),
    });

    observabilityCollectorService.configure({ redisUrl: env.REDIS_URL, executionQueue: queue });
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

    const shutdown = (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, shutting down gracefully...`);
      server.close(async () => {
        clearInterval(metricsRecorder);
        continuousReadinessService.stopScheduler();
        await queue?.close();
        await closeSocketIO();
        await disconnectDB();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start server', err);
    await queue?.close();
    await disconnectDB();
    process.exit(1);
  }
}

startServer();

export {};

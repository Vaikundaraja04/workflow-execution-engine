import { createApp } from './app.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import { loadEnv } from '../config/env.js';
import { BullMqExecutionQueue } from '../queues/bullMqExecutionQueue.js';
import { recoverPendingExecutions } from '../services/executionService.js';

const env = loadEnv();

let isShuttingDown = false;

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

    const shutdown = (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, shutting down gracefully...`);
      server.close(async () => {
        await queue?.close();
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

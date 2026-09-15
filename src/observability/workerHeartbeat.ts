import { Redis } from 'ioredis';
import { logger } from './logger.js';
import { WORKER_HEARTBEAT_KEY } from './health.js';

export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const WORKER_HEARTBEAT_TTL_MS = 30_000;

export interface WorkerHeartbeatOptions {
  key?: string;
  intervalMs?: number;
  ttlMs?: number;
}

export interface WorkerHeartbeatHandle {
  stop: () => Promise<void>;
}

export function startWorkerHeartbeat(
  redisUrl: string,
  options: WorkerHeartbeatOptions = {},
): WorkerHeartbeatHandle {
  const key = options.key ?? WORKER_HEARTBEAT_KEY;
  const intervalMs = options.intervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  const ttlMs = options.ttlMs ?? WORKER_HEARTBEAT_TTL_MS;

  const client = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  client.on('error', error => {
    logger.warn('worker_heartbeat_error', { errorMessage: error.message });
  });

  const beat = () => {
    void client.set(key, new Date().toISOString(), 'PX', ttlMs).catch(() => undefined);
  };

  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      try {
        await client.del(key);
      } catch {
        // The heartbeat expires on its own if Redis is unreachable during shutdown.
      }
      client.disconnect();
    },
  };
}
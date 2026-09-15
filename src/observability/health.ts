import { Redis } from 'ioredis';
import mongoose from 'mongoose';

export type HealthStatus = 'up' | 'down' | 'skipped';

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs: number;
  detail?: string;
}

export const WORKER_HEARTBEAT_KEY = 'workflow-engine:worker:heartbeat';

function skippedCheck(): HealthCheckResult {
  return { status: 'skipped', latencyMs: 0 };
}

export async function checkMongo(): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  const database = mongoose.connection.db;
  if (mongoose.connection.readyState !== 1 || !database) {
    return { status: 'down', latencyMs: Date.now() - startedAt, detail: 'not connected' };
  }
  try {
    await database.admin().ping();
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch {
    return { status: 'down', latencyMs: Date.now() - startedAt, detail: 'ping failed' };
  }
}

async function withRedisClient<T>(redisUrl: string, task: (client: Redis) => Promise<T>): Promise<T> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return await task(client);
  } finally {
    client.disconnect();
  }
}

export async function checkRedis(redisUrl?: string): Promise<HealthCheckResult> {
  if (!redisUrl) return skippedCheck();
  const startedAt = Date.now();
  try {
    const pong = await withRedisClient(redisUrl, client => client.ping());
    return pong === 'PONG'
      ? { status: 'up', latencyMs: Date.now() - startedAt }
      : { status: 'down', latencyMs: Date.now() - startedAt, detail: 'unexpected ping response' };
  } catch {
    return { status: 'down', latencyMs: Date.now() - startedAt, detail: 'unreachable' };
  }
}

export async function checkWorkerAvailability(
  redisUrl?: string,
  key: string = WORKER_HEARTBEAT_KEY,
): Promise<HealthCheckResult> {
  if (!redisUrl) return skippedCheck();
  const startedAt = Date.now();
  try {
    const heartbeat = await withRedisClient(redisUrl, client => client.get(key));
    return heartbeat
      ? { status: 'up', latencyMs: Date.now() - startedAt }
      : { status: 'down', latencyMs: Date.now() - startedAt, detail: 'no worker heartbeat' };
  } catch {
    return { status: 'down', latencyMs: Date.now() - startedAt, detail: 'unreachable' };
  }
}
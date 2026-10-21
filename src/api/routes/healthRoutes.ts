import { Router } from 'express';
import type { Request, Response } from 'express';
import { checkMongo, checkRedis, checkWorkerAvailability } from '../../observability/health.js';
import type { HealthCheckResult } from '../../observability/health.js';
import type { ExecutionQueue } from '../../queues/executionQueue.js';

export interface HealthChecks {
  mongo: () => Promise<HealthCheckResult>;
  redis: () => Promise<HealthCheckResult>;
  worker: () => Promise<HealthCheckResult>;
}

export interface HealthOptions {
  redisUrl?: string;
  workerHeartbeatKey?: string;
  /**
   * The queue the API adds runs to. When given, the Redis check pings this queue's
   * own connection, so a connection that has broken shows up as "down" even while
   * Redis itself is reachable.
   */
  queue?: Pick<ExecutionQueue, 'ping'>;
  /**
   * Report 503 when the worker check is down. Set when the workers run in the API's
   * own process (src/main.ts): restarting the instance is then the fix.
   */
  requireWorker?: boolean;
  checks?: Partial<HealthChecks>;
}

function queueConnectionCheck(queue: Required<Pick<ExecutionQueue, 'ping'>>): () => Promise<HealthCheckResult> {
  return async () => {
    const startedAt = Date.now();
    const reachable = await queue.ping();
    return reachable
      ? { status: 'up', latencyMs: Date.now() - startedAt }
      : { status: 'down', latencyMs: Date.now() - startedAt, detail: 'queue connection unavailable' };
  };
}

export function createHealthChecks(options: HealthOptions = {}): HealthChecks {
  const queue = options.queue;
  const redis = queue?.ping
    ? queueConnectionCheck({ ping: queue.ping.bind(queue) })
    : () => checkRedis(options.redisUrl);
  return {
    mongo: options.checks?.mongo ?? checkMongo,
    redis: options.checks?.redis ?? redis,
    worker: options.checks?.worker
      ?? (() => checkWorkerAvailability(options.redisUrl, options.workerHeartbeatKey)),
  };
}

async function runChecks(checks: HealthChecks): Promise<Record<'mongo' | 'redis' | 'worker', HealthCheckResult>> {
  const safely = async (check: () => Promise<HealthCheckResult>): Promise<HealthCheckResult> => {
    try {
      return await check();
    } catch {
      return { status: 'down', latencyMs: 0, detail: 'check failed' };
    }
  };
  const [mongo, redis, worker] = await Promise.all([
    safely(checks.mongo),
    safely(checks.redis),
    safely(checks.worker),
  ]);
  return { mongo, redis, worker };
}

function report(status: string, checks: Record<string, HealthCheckResult>) {
  return { status, checks, timestamp: new Date().toISOString() };
}

export function createHealthRouter(checks: HealthChecks, options: Pick<HealthOptions, 'requireWorker'> = {}): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    const results = await runChecks(checks);
    const workerDown = results.worker.status === 'down';
    const operational = results.mongo.status === 'up'
      && results.redis.status !== 'down'
      && !(options.requireWorker && workerDown);
    const status = operational ? (workerDown ? 'degraded' : 'ok') : 'unavailable';
    res.status(operational ? 200 : 503).json(report(status, results));
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    const results = await runChecks(checks);
    const ready = results.mongo.status === 'up' && results.redis.status !== 'down';
    res.status(ready ? 200 : 503).json(report(ready ? 'ready' : 'unavailable', results));
  });

  router.get('/live', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return router;
}

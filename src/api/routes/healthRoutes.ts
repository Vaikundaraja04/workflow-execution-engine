import { Router } from 'express';
import type { Request, Response } from 'express';
import { checkMongo, checkRedis, checkWorkerAvailability } from '../../observability/health.js';
import type { HealthCheckResult } from '../../observability/health.js';

export interface HealthChecks {
  mongo: () => Promise<HealthCheckResult>;
  redis: () => Promise<HealthCheckResult>;
  worker: () => Promise<HealthCheckResult>;
}

export interface HealthOptions {
  redisUrl?: string;
  workerHeartbeatKey?: string;
  checks?: Partial<HealthChecks>;
}

export function createHealthChecks(options: HealthOptions = {}): HealthChecks {
  return {
    mongo: options.checks?.mongo ?? checkMongo,
    redis: options.checks?.redis ?? (() => checkRedis(options.redisUrl)),
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

export function createHealthRouter(checks: HealthChecks): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    const results = await runChecks(checks);
    const operational = results.mongo.status === 'up' && results.redis.status !== 'down';
    const degraded = results.worker.status === 'down';
    const status = operational ? (degraded ? 'degraded' : 'ok') : 'unavailable';
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

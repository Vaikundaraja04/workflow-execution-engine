// Covers the failures seen on the free Render deployment: a Redis restart that left the
// API unable to queue runs, jobs lost with Redis data, a dead worker hidden behind a
// healthy API, and login limits shared by everyone behind the hosting proxy.
import { connect, createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';
import { Redis } from 'ioredis';
import type { Job } from 'bullmq';
import { BullMqExecutionQueue, redisReconnectDelay } from '../src/queues/bullMqExecutionQueue.js';
import type { ExecutionEnqueueOptions, ExecutionJobData, ExecutionQueue } from '../src/queues/executionQueue.js';
import { createExecutionJobId } from '../src/queues/executionQueue.js';
import { getAttemptNumber, getMaximumAttempts } from '../src/workers/executionWorker.js';
import {
  EXECUTION_LOST_CODE,
  recoverOrphanedExecutions,
} from '../src/services/executionService.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { DeadLetterModel } from '../src/models/DeadLetterModel.js';
import { createHealthChecks, createHealthRouter } from '../src/api/routes/healthRoutes.js';
import type { HealthCheckResult } from '../src/observability/health.js';
import { createAuthRateLimiters, loginRateLimitKey, refreshRateLimitKey } from '../src/api/middleware/rateLimiter.js';
import { resolveTrustProxy } from '../src/api/trustProxy.js';
import { RateLimitService } from '../src/services/rateLimitService.js';

const up: HealthCheckResult = { status: 'up', latencyMs: 0 };
const down: HealthCheckResult = { status: 'down', latencyMs: 0 };

describe('Redis reconnection', () => {
  it('keeps retrying with a capped delay instead of giving up', () => {
    expect(redisReconnectDelay(1)).toBe(200);
    expect(redisReconnectDelay(3)).toBe(600);
    expect(redisReconnectDelay(10_000)).toBe(5_000);
    for (const attempt of [1, 3, 25, 1_000]) {
      expect(typeof redisReconnectDelay(attempt)).toBe('number');
    }
  });

  /**
   * A small TCP relay in front of Redis. Closing it makes Redis unreachable for the
   * queue (like a Key Value restart) while the test controls exactly how long.
   */
  function createRelay(targetPort: number) {
    let server: Server | null = null;
    let port = 0;
    const sockets = new Set<Socket>();
    return {
      get port() { return port; },
      start: () => new Promise<void>((resolve, reject) => {
        server = createServer((client) => {
          const upstream = connect(targetPort, '127.0.0.1');
          sockets.add(client);
          sockets.add(upstream);
          const cleanup = () => {
            client.destroy();
            upstream.destroy();
            sockets.delete(client);
            sockets.delete(upstream);
          };
          client.on('error', cleanup).on('close', cleanup);
          upstream.on('error', cleanup).on('close', cleanup);
          client.pipe(upstream).pipe(client);
        });
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          port = (server!.address() as AddressInfo).port;
          resolve();
        });
      }),
      stop: () => new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      }),
    };
  }

  it('queues runs again after Redis has been unreachable for a while', async () => {
    const redis = await RedisMemoryServer.create();
    const relay = createRelay(await redis.getPort());
    await relay.start();
    const queue = new BullMqExecutionQueue(`redis://127.0.0.1:${relay.port}`, `outage-${randomUUID()}`);
    const admin = new Redis(`redis://127.0.0.1:${await redis.getPort()}`);
    try {
      await queue.waitUntilReady();
      const first = new Types.ObjectId().toString();
      await queue.enqueue({ executionId: first }, { jobId: createExecutionJobId(first), attempts: 1, backoffMs: 10 });
      expect(await queue.ping()).toBe(true);

      // Unreachable for 3 seconds: the old settings gave up reconnecting after about 0.6 s.
      await relay.stop();
      expect(await queue.ping(500)).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      // Redis comes back empty, as a free Key Value instance does after a restart.
      await admin.flushall();
      await relay.start();

      const deadline = Date.now() + 15_000;
      while (!(await queue.ping(500))) {
        if (Date.now() > deadline) throw new Error('queue connection never came back');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const second = new Types.ObjectId().toString();
      await queue.enqueue({ executionId: second }, { jobId: createExecutionJobId(second), attempts: 1, backoffMs: 10 });
      expect(await queue.getJobState(createExecutionJobId(second))).toBe('waiting');
      // The wipe removed the earlier job; that is how a lost job looks to the sweep.
      expect(await queue.getJobState(createExecutionJobId(first))).toBe('unknown');
    } finally {
      await queue.close();
      admin.disconnect();
      await relay.stop();
      await redis.stop();
    }
  }, 60_000);
});

describe('attempt numbering for re-queued runs', () => {
  function fakeJob(data: ExecutionJobData, attempts: number, attemptsMade: number, attemptsStarted: number) {
    return { data, opts: { attempts }, attemptsMade, attemptsStarted } as unknown as Job<ExecutionJobData>;
  }

  it('is unchanged for a normal job', () => {
    const job = fakeJob({ executionId: 'x' }, 3, 0, 1);
    expect(getAttemptNumber(job)).toBe(1);
    expect(getMaximumAttempts(job)).toBe(3);
  });

  it('carries on from attempts used before the job was lost', () => {
    const job = fakeJob({ executionId: 'x', attemptOffset: 2 }, 1, 0, 1);
    expect(getAttemptNumber(job)).toBe(3);
    expect(getMaximumAttempts(job)).toBe(3);
  });
});

describe('recovering runs whose queue job was lost', () => {
  let replSet: MongoMemoryReplSet;

  class FakeQueue implements ExecutionQueue {
    states = new Map<string, string>();
    enqueued: Array<{ data: ExecutionJobData; options: ExecutionEnqueueOptions }> = [];
    failLookups = false;
    async enqueue(data: ExecutionJobData, options: ExecutionEnqueueOptions) {
      this.enqueued.push({ data, options });
      this.states.set(options.jobId, 'waiting');
    }
    async getJobState(jobId: string) {
      if (this.failLookups) throw new Error('Connection is closed.');
      return this.states.get(jobId) ?? 'unknown';
    }
    async close() {}
  }

  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  async function insertExecution(fields: Record<string, unknown>) {
    const _id = new Types.ObjectId();
    await WorkflowExecutionModel.collection.insertOne({
      _id,
      workflowId: new Types.ObjectId(),
      ownerId: new Types.ObjectId(),
      workflowVersionId: new Types.ObjectId(),
      versionNumber: 1,
      jobId: createExecutionJobId(_id.toString()),
      idempotencyKey: randomUUID(),
      inputHash: 'hash',
      input: {},
      attemptsMade: 0,
      maxRetries: 2,
      retryCount: 0,
      statusHistory: [],
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(10),
      ...fields,
    });
    return _id;
  }

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }, 30_000);

  beforeEach(async () => {
    await WorkflowExecutionModel.deleteMany({});
    await DeadLetterModel.deleteMany({});
  });

  it('re-queues a waiting run whose job vanished, keeping its attempt count', async () => {
    const id = await insertExecution({ status: 'QUEUED', attemptsMade: 1, nextRetryAt: new Date(Date.now() + 30_000) });
    const queue = new FakeQueue();

    const summary = await recoverOrphanedExecutions(queue);

    expect(summary).toEqual({ examined: 1, requeued: 1, failed: 0 });
    expect(queue.enqueued).toHaveLength(1);
    const [entry] = queue.enqueued;
    expect(entry!.data).toEqual({ executionId: id.toString(), attemptOffset: 1 });
    expect(entry!.options.attempts).toBe(2);
    expect(entry!.options.delayMs).toBeGreaterThan(20_000);
  });

  it('leaves runs alone while their job exists or they are new', async () => {
    const withJob = await insertExecution({ status: 'QUEUED' });
    await insertExecution({ status: 'QUEUED', updatedAt: new Date() });
    const queue = new FakeQueue();
    queue.states.set(createExecutionJobId(withJob.toString()), 'waiting');

    const summary = await recoverOrphanedExecutions(queue);

    expect(summary.requeued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it('puts a run that lost its job mid-attempt back in the queue', async () => {
    const id = await insertExecution({
      status: 'RUNNING',
      attemptsMade: 1,
      timeoutMs: 30_000,
      startedAt: minutesAgo(10),
    });
    const queue = new FakeQueue();

    await recoverOrphanedExecutions(queue);

    const stored = await WorkflowExecutionModel.findById(id).lean();
    expect(stored?.status).toBe('QUEUED');
    expect(queue.enqueued[0]?.data.attemptOffset).toBe(1);
    expect(queue.enqueued[0]?.options.attempts).toBe(2);
    expect(queue.enqueued[0]?.options.delayMs).toBe(0);
  });

  it('does not touch a run that may still be inside its time limit', async () => {
    await insertExecution({ status: 'RUNNING', attemptsMade: 1, timeoutMs: 600_000, startedAt: minutesAgo(5) });
    const queue = new FakeQueue();

    await recoverOrphanedExecutions(queue);

    expect(queue.enqueued).toHaveLength(0);
  });

  it('fails a lost run that has no attempts left and records a dead letter', async () => {
    const id = await insertExecution({ status: 'QUEUED', attemptsMade: 3 });
    const queue = new FakeQueue();

    const summary = await recoverOrphanedExecutions(queue);

    expect(summary).toEqual({ examined: 1, requeued: 0, failed: 1 });
    const stored = await WorkflowExecutionModel.findById(id).lean();
    expect(stored?.status).toBe('FAILED');
    expect(stored?.error?.code).toBe(EXECUTION_LOST_CODE);
    expect(await DeadLetterModel.countDocuments({ executionId: id })).toBe(1);
  });

  it('changes nothing while Redis cannot be reached', async () => {
    const id = await insertExecution({ status: 'QUEUED' });
    const queue = new FakeQueue();
    queue.failLookups = true;

    await recoverOrphanedExecutions(queue);

    expect(queue.enqueued).toHaveLength(0);
    expect((await WorkflowExecutionModel.findById(id).lean())?.status).toBe('QUEUED');
  });
});

describe('health with workers in the same process', () => {
  function healthApp(options: Parameters<typeof createHealthChecks>[0], requireWorker: boolean) {
    const app = express();
    app.use('/health', createHealthRouter(createHealthChecks(options), { requireWorker }));
    return supertest(app);
  }

  it('reports 503 when in-process workers have stopped, so the host restarts it', async () => {
    const response = await healthApp({ checks: { mongo: async () => up, redis: async () => up, worker: async () => down } }, true).get('/health');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
  });

  it('keeps 200 "degraded" for a separate worker service', async () => {
    const response = await healthApp({ checks: { mongo: async () => up, redis: async () => up, worker: async () => down } }, false).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
  });

  it('checks the queue connection the API really uses', async () => {
    const brokenQueue = { ping: async () => false };
    const response = await healthApp({ queue: brokenQueue, checks: { mongo: async () => up, worker: async () => up } }, true).get('/health');
    expect(response.status).toBe(503);
    expect(response.body.checks.redis.detail).toBe('queue connection unavailable');
  });
});

describe('login limits behind a hosting proxy', () => {
  function limitedApp(loginLimit: number, refreshLimit: number) {
    const app = express();
    app.use(express.json());
    const limiters = createAuthRateLimiters({ windowMs: 60_000, loginLimit, refreshLimit });
    app.post('/login', limiters.login, (_req, res) => res.status(401).end());
    app.post('/refresh', limiters.refresh, (_req, res) => res.status(401).end());
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.message === 'RATE_LIMITED' ? 429 : 500).end();
    });
    return supertest(app);
  }

  it('counts attempts per account, so one account cannot lock out everyone else', async () => {
    const request = limitedApp(2, 100);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await request.post('/login').send({ email: 'a@example.com', password: 'x' })).status).toBe(401);
    }
    expect((await request.post('/login').send({ email: 'A@example.com ', password: 'x' })).status).toBe(429);
    // Same proxy address, different person: still allowed.
    expect((await request.post('/login').send({ email: 'b@example.com', password: 'x' })).status).toBe(401);
  });

  it('counts refreshes per session token', async () => {
    const request = limitedApp(100, 1);
    expect((await request.post('/refresh').send({ refreshToken: 'session-one' })).status).toBe(401);
    expect((await request.post('/refresh').send({ refreshToken: 'session-one' })).status).toBe(429);
    expect((await request.post('/refresh').send({ refreshToken: 'session-two' })).status).toBe(401);
  });

  it('falls back to the client address when the body has no account or token', () => {
    const req = { body: {}, ip: '203.0.113.9' } as unknown as express.Request;
    expect(loginRateLimitKey(req)).toBe('ip:203.0.113.9');
    expect(refreshRateLimitKey(req)).toBe('ip:203.0.113.9');
  });
});

describe('TRUST_PROXY setting', () => {
  it('maps environment values to Express trust proxy values', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy('')).toBe(false);
    expect(resolveTrustProxy('1')).toBe(1);
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});

describe('API key limits while Redis is down', () => {
  it('fails open at once instead of making requests wait for a reconnect', async () => {
    // Nothing listens on port 1, so the client keeps reconnecting in the background.
    const service = new RateLimitService('redis://127.0.0.1:1');
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const startedAt = Date.now();
      const first = await service.checkApiKeyLimit('key-1', 5);
      const second = await service.checkWorkspaceLimit('workspace-1', 5);
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(2_500);
    } finally {
      await service.close();
    }
  });
});

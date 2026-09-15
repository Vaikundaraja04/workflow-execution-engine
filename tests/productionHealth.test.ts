import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';
import { Redis } from 'ioredis';
import { createApp } from '../src/api/app.js';
import { WORKER_HEARTBEAT_KEY } from '../src/observability/health.js';
import { startWorkerHeartbeat } from '../src/observability/workerHeartbeat.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let redisServer: RedisMemoryServer;
let redisUrl: string;
let request: ReturnType<typeof supertest>;
let unreachableRedisRequest: ReturnType<typeof supertest>;

beforeAll(async () => {
  const platformArgs = process.platform === 'win32' || process.env.MONGOMS_SYSTEM_BINARY
    ? []
    : ['--nounixsocket'];
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, args: platformArgs } });
  redisServer = await RedisMemoryServer.create();
  redisUrl = 'redis://' + (await redisServer.getHost()) + ':' + (await redisServer.getPort());
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({ auth: authConfig, health: { redisUrl } }));
  unreachableRedisRequest = supertest(createApp({
    auth: authConfig,
    health: { redisUrl: 'redis://127.0.0.1:6399' },
  }));
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (redisServer) await redisServer.stop();
  if (replSet) await replSet.stop();
}, 30_000);

describe('Phase 4 health monitoring', () => {
  it('reports liveness for a running process', async () => {
    const response = await request.get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('reports readiness with MongoDB and Redis reachable', async () => {
    const response = await request.get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.mongo.status).toBe('up');
    expect(response.body.checks.redis.status).toBe('up');
  });

  it('reports a degraded status while no worker heartbeat is present', async () => {
    const response = await request.get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.worker).toMatchObject({ status: 'down', detail: 'no worker heartbeat' });
  });

  it('reports ok once a worker heartbeat is published', async () => {
    const client = new Redis(redisUrl);
    try {
      await client.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'PX', 30_000);
      const response = await request.get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.checks.worker.status).toBe('up');
    } finally {
      client.disconnect();
    }
  });

  it('reports unavailable when Redis is unreachable', async () => {
    const ready = await unreachableRedisRequest.get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('unavailable');
    expect(ready.body.checks.redis).toMatchObject({ status: 'down', detail: 'unreachable' });

    const health = await unreachableRedisRequest.get('/health');
    expect(health.status).toBe(503);
    expect(health.body.status).toBe('unavailable');

    const live = await unreachableRedisRequest.get('/health/live');
    expect(live.status).toBe(200);
  });

  it('publishes and clears the worker heartbeat key', async () => {
    const client = new Redis(redisUrl);
    const heartbeat = startWorkerHeartbeat(redisUrl, { intervalMs: 50, ttlMs: 5_000 });
    try {
      const published = await client.get(WORKER_HEARTBEAT_KEY);
      expect(published).toBeTruthy();

      await heartbeat.stop();
      expect(await client.get(WORKER_HEARTBEAT_KEY)).toBeNull();
    } finally {
      client.disconnect();
    }
  });
});

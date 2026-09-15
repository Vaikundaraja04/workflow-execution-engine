import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { RateLimitBucketModel } from '../src/models/RateLimitBucketModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { BullMqExecutionQueue } from '../src/queues/bullMqExecutionQueue.js';
import { BullMqWebhookQueue } from '../src/queues/bullMqWebhookQueue.js';
import { createHash, randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { Redis } from 'ioredis';
import { closeRateLimiter } from '../src/api/middleware/rateLimitMiddleware.js';
import { RateLimitService, getRateLimitService, resetDefaultRateLimitService } from '../src/services/rateLimitService.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

function validDefinition(): WorkflowDefinition {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message: 'external-trigger' } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  };
}

describe('Rate Limiting', () => {
  let mongoServer: MongoMemoryServer;
  let redisServer: RedisMemoryServer;
  let app: Express;
  let executionQueue: BullMqExecutionQueue;
  let webhookQueue: BullMqWebhookQueue;
  let redisClient: Redis;
  let redisUrl: string;

  let testUserId: string;
  let workspaceId: string;
  let workflowId: string;
  let apiKey1: string;
  let apiKeyId1: string;
  let apiKey2: string;
  let apiKeyId2: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    redisServer = await RedisMemoryServer.create();
    redisUrl = `redis://127.0.0.1:${await redisServer.getPort()}`;
    process.env.REDIS_URL = redisUrl;

    executionQueue = new BullMqExecutionQueue(redisUrl);
    webhookQueue = new BullMqWebhookQueue(redisUrl);
    await executionQueue.waitUntilReady();
    await webhookQueue.waitUntilReady();

    redisClient = new Redis(redisUrl);

    app = createApp({
      executionQueue,
      webhookQueue,
      executionCreationOptions: {
        attempts: 3,
        backoffMs: 10,
      },
      auth: {
        jwtSecret: 'test-jwt-secret-0123456789abcdef',
        accessTtl: '15m',
        refreshTtl: '30d',
      },
      authRateLimit: { loginLimit: 10000, refreshLimit: 10000 },
      rateLimit: { limit: 10000 },
      health: { redisUrl },
    });
  }, 60000);

  afterAll(async () => {
    await closeRateLimiter();
    resetDefaultRateLimitService();
    await redisClient.quit();
    await executionQueue.close();
    await webhookQueue.close();
    await mongoose.disconnect();
    await mongoServer.stop();
    await redisServer.stop();
  }, 30000);

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await WorkspaceMemberModel.deleteMany({});
    await WorkflowModel.deleteMany({});
    await WorkflowVersionModel.deleteMany({});
    await APIKeyModel.deleteMany({});
    await RateLimitBucketModel.deleteMany({});

    // Clear Redis
    await redisClient.flushdb();

    // Create test user and workspace
    const hashedPassword = await hashPassword('password123');
    const user = await UserModel.create({
      email: 'test@example.com',
      passwordHash: hashedPassword,
    });
    testUserId = user._id.toString();

    const workspace = await WorkspaceModel.create({
      name: 'Test Workspace',
      slug: 'test-workspace',
      ownerId: user._id,
    });
    workspaceId = workspace._id.toString();

    await WorkspaceMemberModel.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: 'OWNER',
      status: 'ACTIVE',
    });

    // Create test published workflow
    const workflow = await WorkflowModel.create({
      workspaceId: workspace._id,
      name: 'Test Workflow',
      ownerId: user._id,
      draftDefinition: validDefinition(),
      status: 'DRAFT',
      latestVersionNumber: 1,
    });
    const version = await WorkflowVersionModel.create({
      workflowId: workflow._id,
      versionNumber: 1,
      definition: validDefinition(),
    });
    workflow.status = 'PUBLISHED';
    workflow.publishedVersionId = version._id;
    await workflow.save();
    workflowId = workflow._id.toString();

    // Create API keys with different rate limits
    const rawKey1 = 'wke_' + randomBytes(32).toString('hex');
    const keyHash1 = createHash('sha256').update(rawKey1).digest('hex');
    const key1 = await APIKeyModel.create({
      workspaceId: workspace._id,
      name: 'Test Key 1',
      keyHash: keyHash1,
      keyPrefix: rawKey1.slice(0, 8),
      status: 'ACTIVE',
      permissions: ['WORKFLOW_EXECUTE'],
      createdBy: user._id,
      rateLimit: {
        requestsPerMinute: 5,
        executionsPerHour: 10,
      },
    });
    apiKey1 = rawKey1;
    apiKeyId1 = key1._id.toString();

    const rawKey2 = 'wke_' + randomBytes(32).toString('hex');
    const keyHash2 = createHash('sha256').update(rawKey2).digest('hex');
    const key2 = await APIKeyModel.create({
      workspaceId: workspace._id,
      name: 'Test Key 2',
      keyHash: keyHash2,
      keyPrefix: rawKey2.slice(0, 8),
      status: 'ACTIVE',
      permissions: ['WORKFLOW_EXECUTE'],
      createdBy: user._id,
      rateLimit: {
        requestsPerMinute: 3,
        executionsPerHour: 10,
      },
    });
    apiKey2 = rawKey2;
    apiKeyId2 = key2._id.toString();
  });

  afterEach(async () => {
    await redisClient.flushdb();
  });

  describe('API KEY LIMIT', () => {
    it('first requests allowed and remaining header correct', async () => {
      const response = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'test-1' })
        .expect(202);

      expect(response.headers['x-ratelimit-limit']).toBe('5');
      expect(response.headers['x-ratelimit-remaining']).toBe('4');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('limit exceeded returns 429', async () => {
      // Make 5 requests (the limit)
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post(`/api/v1/workflows/${workflowId}/trigger`)
          .set('X-API-Key', apiKey1)
          .send({ input: {}, idempotencyKey: `test-limit-${i}` })
          .expect(202);
      }

      // 6th request should be rate limited
      const response = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'test-limit-6' })
        .expect(429);

      expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.message).toBe('Too many requests');
      expect(response.body.retryAfter).toBeGreaterThanOrEqual(1);
      expect(response.headers['retry-after']).toBeDefined();
    });

    it('remaining header correctly decrements', async () => {
      let response = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'test-track-1' })
        .expect(202);
      expect(response.headers['x-ratelimit-remaining']).toBe('4');

      response = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'test-track-2' })
        .expect(202);
      expect(response.headers['x-ratelimit-remaining']).toBe('3');

      response = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'test-track-3' })
        .expect(202);
      expect(response.headers['x-ratelimit-remaining']).toBe('2');
    });

    it('reset window works after cache cleared', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post(`/api/v1/workflows/${workflowId}/trigger`)
          .set('X-API-Key', apiKey1)
          .send({ input: {}, idempotencyKey: `test-reset-${i}` })
          .expect(202);
      }

      await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'test-reset-fail' })
        .expect(429);

      // Simulate window reset by flushing Redis
      await redisClient.flushdb();

      const response = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'test-reset-success' })
        .expect(202);

      expect(response.headers['x-ratelimit-remaining']).toBe('4');
    });
  });

  describe('WORKSPACE LIMIT', () => {
    it('workspace execution limit enforced and shared across API keys', async () => {
      // Set workspace quota low on both keys (executionsPerHour = 4)
      await APIKeyModel.updateOne({ _id: new Types.ObjectId(apiKeyId1) }, { 'rateLimit.executionsPerHour': 4 });
      await APIKeyModel.updateOne({ _id: new Types.ObjectId(apiKeyId2) }, { 'rateLimit.executionsPerHour': 4 });

      // Key 1 makes 2 requests
      await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'share-1' })
        .expect(202);
      await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'share-2' })
        .expect(202);

      // Key 2 makes 2 requests (total 4 reaches the workspace limit)
      await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey2)
        .send({ input: {}, idempotencyKey: 'share-3' })
        .expect(202);
      await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey2)
        .send({ input: {}, idempotencyKey: 'share-4' })
        .expect(202);

      // Next request from Key 1 or Key 2 should be rejected because workspace quota is exhausted
      const res1 = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: {}, idempotencyKey: 'share-5' })
        .expect(429);

      expect(res1.body.code).toBe('RATE_LIMIT_EXCEEDED');

      const res2 = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey2)
        .send({ input: {}, idempotencyKey: 'share-6' })
        .expect(429);

      expect(res2.body.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('REDIS', () => {
    it('performs atomic increment and expiration handling', async () => {
      const rateService = new RateLimitService(redisClient);
      const testKey = 'test-redis-key';

      const res1 = await rateService.checkApiKeyLimit(testKey, 10, 60);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(9);
      expect(res1.limit).toBe(10);

      const res2 = await rateService.checkApiKeyLimit(testKey, 10, 60);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(8);

      // Check redis key ttl
      const nowSeconds = Math.floor(Date.now() / 1000);
      const windowStart = rateService.getWindowStart(60, nowSeconds);
      const redisKey = `ratelimit:apikey:${testKey}:${windowStart}`;
      const ttl = await redisClient.ttl(redisKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(120);

      const val = await redisClient.get(redisKey);
      expect(val).toBe('2');
    });
  });

  describe('ADMIN API', () => {
    let ownerToken: string;
    let adminToken: string;
    let editorToken: string;
    let viewerToken: string;

    beforeEach(async () => {
      // Owner login
      const ownerLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(200);
      ownerToken = ownerLogin.body.accessToken;

      // Admin user
      const adminPass = await hashPassword('password123');
      const adminUser = await UserModel.create({ email: 'admin@example.com', passwordHash: adminPass });
      await WorkspaceMemberModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: adminUser._id,
        role: 'ADMIN',
        status: 'ACTIVE',
      });
      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@example.com', password: 'password123' })
        .expect(200);
      adminToken = adminLogin.body.accessToken;

      // Editor user
      const editorPass = await hashPassword('password123');
      const editorUser = await UserModel.create({ email: 'editor@example.com', passwordHash: editorPass });
      await WorkspaceMemberModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: editorUser._id,
        role: 'EDITOR',
        status: 'ACTIVE',
      });
      const editorLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'editor@example.com', password: 'password123' })
        .expect(200);
      editorToken = editorLogin.body.accessToken;

      // Viewer user
      const viewerPass = await hashPassword('password123');
      const viewerUser = await UserModel.create({ email: 'viewer@example.com', passwordHash: viewerPass });
      await WorkspaceMemberModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: viewerUser._id,
        role: 'VIEWER',
        status: 'ACTIVE',
      });
      const viewerLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'viewer@example.com', password: 'password123' })
        .expect(200);
      viewerToken = viewerLogin.body.accessToken;
    });

    it('owner can update limits', async () => {
      const response = await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({
          requestsPerMinute: 2000,
          executionsPerHour: 10000,
        })
        .expect(200);

      expect(response.body.rateLimit.requestsPerMinute).toBe(2000);
      expect(response.body.rateLimit.executionsPerHour).toBe(10000);
    });

    it('admin can update limits', async () => {
      const response = await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({
          requestsPerMinute: 1500,
          executionsPerHour: 8000,
        })
        .expect(200);

      expect(response.body.rateLimit.requestsPerMinute).toBe(1500);
      expect(response.body.rateLimit.executionsPerHour).toBe(8000);
    });

    it('editor is denied from updating limits', async () => {
      await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${editorToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({ requestsPerMinute: 1000 })
        .expect(403);
    });

    it('viewer is denied from updating limits', async () => {
      await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({ requestsPerMinute: 1000 })
        .expect(403);
    });

    it('validates positive numbers', async () => {
      await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({ requestsPerMinute: -5 })
        .expect(400);

      await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({ requestsPerMinute: 0 })
        .expect(400);
    });

    it('enforces maximum safety limits', async () => {
      await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({ requestsPerMinute: 20000 })
        .expect(400);

      await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({ executionsPerHour: 200000 })
        .expect(400);
    });

    it('requires at least one field', async () => {
      await request(app)
        .patch(`/api/v1/keys/${apiKeyId1}/limits`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Workspace-Id', workspaceId)
        .send({})
        .expect(400);
    });
  });

  describe('SECURITY', () => {
    let otherWorkspaceId: string;
    let otherApiKeyId: string;
    let otherOwnerToken: string;

    beforeEach(async () => {
      const hashedPassword = await hashPassword('password123');
      const otherUser = await UserModel.create({
        email: 'other@example.com',
        passwordHash: hashedPassword,
      });

      const otherWorkspace = await WorkspaceModel.create({
        name: 'Other Workspace',
        slug: 'other-workspace',
        ownerId: otherUser._id,
      });
      otherWorkspaceId = otherWorkspace._id.toString();

      await WorkspaceMemberModel.create({
        workspaceId: otherWorkspace._id,
        userId: otherUser._id,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      const rawKey = 'wke_' + randomBytes(32).toString('hex');
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const key = await APIKeyModel.create({
        workspaceId: otherWorkspace._id,
        name: 'Other Key',
        keyHash: keyHash,
        keyPrefix: rawKey.slice(0, 8),
        status: 'ACTIVE',
        permissions: ['WORKFLOW_EXECUTE'],
        createdBy: otherUser._id,
      });
      otherApiKeyId = key._id.toString();

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'other@example.com', password: 'password123' })
        .expect(200);
      otherOwnerToken = loginRes.body.accessToken;
    });

    it('cross workspace cannot modify limits', async () => {
      await request(app)
        .patch(`/api/v1/keys/${otherApiKeyId}/limits`)
        .set('Authorization', `Bearer ${otherOwnerToken}`)
        .set('X-Workspace-Id', workspaceId) // Wrong workspace header
        .send({ requestsPerMinute: 1000 })
        .expect(404); // Returns 404 to avoid leaking workspace membership info
    });

    it('invalid API key is rejected', async () => {
      await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', 'wke_invalidkey123456')
        .send({ input: {}, idempotencyKey: 'invalid-key-test' })
        .expect(401);
    });
  });

  describe('REGRESSION', () => {
    it('existing external trigger flow passes and executes', async () => {
      const response = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: { test: 'data' }, idempotencyKey: 'reg-test-1' })
        .expect(202);

      expect(response.body.executionId).toBeDefined();
      expect(response.body.status).toBe('QUEUED');
      expect(response.body.replayed).toBe(false);
    });

    it('idempotent external triggers succeed with rate limit headers', async () => {
      const idemKey = 'idempotency-key-test-abc';

      const first = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: { data: 1 }, idempotencyKey: idemKey })
        .expect(202);

      const second = await request(app)
        .post(`/api/v1/workflows/${workflowId}/trigger`)
        .set('X-API-Key', apiKey1)
        .send({ input: { data: 1 }, idempotencyKey: idemKey })
        .expect(202);

      expect(first.body.executionId).toBe(second.body.executionId);
      expect(second.body.replayed).toBe(true);
    });
  });
});

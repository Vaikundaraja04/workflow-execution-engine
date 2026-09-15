import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createHmac } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from '../src/api/app.js';
import { WebhookModel } from '../src/models/WebhookModel.js';
import { WebhookDeliveryModel } from '../src/models/WebhookDeliveryModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { encryptSecret, decryptSecret, signPayload } from '../src/services/webhookService.js';
import { dispatchExecutionStarted, dispatchExecutionCompleted } from '../src/services/webhookDispatcher.js';
import type { WebhookQueue } from '../src/queues/webhookQueue.js';

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-jwt-signing-and-verification',
  accessTtl: '1h',
  refreshTtl: '30d',
};
const TEST_WEBHOOK_SECRET_KEY = 'test-webhook-secret-32-chars-!!';

describe('Webhook System - Phase 4A.3', () => {
  let app: Express;
  let accessToken: string;
  let workspaceId: string;
  let userId: string;
  let mockQueue: WebhookQueue;
  let replSet: MongoMemoryReplSet;
  const enqueuedJobs: Array<{ data: { deliveryId: string }; options: unknown }> = [];

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    process.env.WEBHOOK_SECRET_KEY = TEST_WEBHOOK_SECRET_KEY;

    // Create mock webhook queue
    mockQueue = {
      enqueue: async (data, options) => {
        enqueuedJobs.push({ data, options });
      },
      close: async () => {},
    };

    app = createApp({
      auth: authConfig,
      webhookQueue: mockQueue,
      docs: false,
    });
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }, 30_000);

  beforeEach(async () => {
    enqueuedJobs.length = 0;

    const workspace = await WorkspaceModel.create({
      name: 'Webhook Test Workspace',
      slug: 'webhook-test',
      ownerId: new mongoose.Types.ObjectId(),
    });
    workspaceId = workspace._id.toString();

    // Create test user and set default workspace
    const user = await UserModel.create({
      email: 'webhook-test@example.com',
      passwordHash: 'hash',
      defaultWorkspaceId: workspace._id,
    });
    userId = user._id.toString();

    await WorkspaceMemberModel.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: 'ADMIN',
      permissions: permissionsForRole('ADMIN'),
      status: 'ACTIVE',
    });

    accessToken = signAccessToken(
      authConfig,
      { userId: user._id.toString(), email: user.email },
    );
  });

  afterEach(async () => {
    await WebhookDeliveryModel.deleteMany({});
    await WebhookModel.deleteMany({});
    await WorkflowExecutionModel.deleteMany({});
    await WorkflowModel.deleteMany({});
    await WorkspaceMemberModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await UserModel.deleteMany({});
  });

  describe('Secret Encryption & Signing', () => {
    it('should encrypt and decrypt secrets correctly', () => {
      const plaintext = 'my-webhook-secret-token';
      const { encryptedData, iv, tag } = encryptSecret(plaintext);

      expect(encryptedData).toBeTruthy();
      expect(iv).toBeTruthy();
      expect(tag).toBeTruthy();

      const decrypted = decryptSecret(encryptedData, iv, tag);
      expect(decrypted).toBe(plaintext);
    });

    it('should generate HMAC-SHA256 signatures correctly', () => {
      const payload = JSON.stringify({ event: 'test', data: 'value' });
      const secret = 'test-secret';

      const signature = signPayload(payload, secret);
      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      expect(signature).toBe(expectedSignature);
    });

    it('should fail decryption with wrong IV or tag', () => {
      const plaintext = 'my-webhook-secret-token';
      const { encryptedData, iv, tag } = encryptSecret(plaintext);

      expect(() => decryptSecret(encryptedData, 'wrong-iv', tag)).toThrow();
      expect(() => decryptSecret(encryptedData, iv, 'wrong-tag')).toThrow();
    });
  });

  describe('Webhook CRUD Operations', () => {
    it('should create a webhook with HTTPS URL', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`)
                .send({
          name: 'Production Alerts',
          url: 'https://example.com/webhooks/workflow',
          events: ['WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED'],
        })
        .expect(201);

      expect(response.body.id).toBeTruthy();
      expect(response.body.name).toBe('Production Alerts');
      expect(response.body.url).toBe('https://example.com/webhooks/workflow');
      expect(response.body.events).toEqual(['WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED']);
      expect(response.body.status).toBe('ACTIVE');
      expect(response.body.secret).toBeTruthy();
      expect(response.body.secret.length).toBe(64); // 32 bytes hex-encoded

      // Verify secret is stored encrypted
      const webhook = await WebhookModel.findById(response.body.id);
      expect(webhook).toBeTruthy();
      expect(webhook!.encryptedSecret).toContain('.');
      expect(webhook!.encryptedSecret.split('.')).toHaveLength(3);
    });

    it('should reject non-HTTPS webhook URLs', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`)
                .send({
          name: 'Insecure Hook',
          url: 'http://example.com/webhook',
          events: ['WORKFLOW_EXECUTION_COMPLETED'],
        })
        .expect(400);

      expect(response.body.error.code).toBe('WEBHOOK_URL_MUST_BE_HTTPS');
    });

    it('should reject webhooks with no events', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`)
                .send({
          name: 'No Events',
          url: 'https://example.com/webhook',
          events: [],
        })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should reject webhooks with invalid events', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`)
                .send({
          name: 'Bad Events',
          url: 'https://example.com/webhook',
          events: ['INVALID_EVENT'],
        })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should list all webhooks in workspace', async () => {
      await WebhookModel.create([
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          name: 'Webhook 1',
          url: 'https://example.com/webhook1',
          events: ['WORKFLOW_EXECUTION_STARTED'],
          encryptedSecret: 'enc1.iv1.tag1',
          status: 'ACTIVE',
          createdBy: new mongoose.Types.ObjectId(userId),
          createdAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          name: 'Webhook 2',
          url: 'https://example.com/webhook2',
          events: ['WORKFLOW_EXECUTION_COMPLETED'],
          encryptedSecret: 'enc2.iv2.tag2',
          status: 'PAUSED',
          createdBy: new mongoose.Types.ObjectId(userId),
          createdAt: new Date('2026-01-02T10:00:00.000Z'),
        },
      ]);

      const response = await request(app)
        .get('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('Webhook 2'); // Sorted by createdAt desc
      expect(response.body[1].name).toBe('Webhook 1');
      expect(response.body[0].secret).toBeUndefined(); // Secret not returned in list
    });

    it('should get webhook by ID', async () => {
      // Create webhook via API
      const createResponse = await request(app)
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`)
                .send({
          name: 'Test Webhook',
          url: 'https://example.com/webhook',
          events: ['WORKFLOW_EXECUTION_COMPLETED'],
        })
        .expect(201);

      const webhookId = createResponse.body.id;

      const response = await request(app)
        .get(`/api/v1/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

      expect(response.body.id).toBe(webhookId);
      expect(response.body.name).toBe('Test Webhook');
      expect(response.body.secret).toBeUndefined(); // Secret not returned on get
    });

    it('should update webhook', async () => {
      const webhook = await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Original Name',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_STARTED'],
        encryptedSecret: 'enc.iv.tag',
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      const response = await request(app)
        .patch(`/api/v1/webhooks/${webhook._id.toString()}`)
        .set('Authorization', `Bearer ${accessToken}`)
                .send({
          name: 'Updated Name',
          status: 'PAUSED',
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.status).toBe('PAUSED');
    });

    it('should soft-delete webhook', async () => {
      const webhook = await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'To Delete',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: 'enc.iv.tag',
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      await request(app)
        .delete(`/api/v1/webhooks/${webhook._id.toString()}`)
        .set('Authorization', `Bearer ${accessToken}`)
                .expect(204);

      const deleted = await WebhookModel.findById(webhook._id);
      expect(deleted).toBeTruthy();
      expect(deleted!.status).toBe('DISABLED');
    });
  });

  describe('RBAC & Tenancy', () => {
    it('should require MEMBER_MANAGE permission', async () => {
      // Create a viewer member
      const viewer = await UserModel.create({
        email: 'viewer@example.com',
        passwordHash: 'hash',
        defaultWorkspaceId: new mongoose.Types.ObjectId(workspaceId),
      });

      await WorkspaceMemberModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        userId: viewer._id,
        role: 'VIEWER',
        permissions: permissionsForRole('VIEWER'),
        status: 'ACTIVE',
      });

      const viewerToken = signAccessToken(
        authConfig,
        { userId: viewer._id.toString(), email: viewer.email },
      );

      const response = await request(app)
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          name: 'Unauthorized',
          url: 'https://example.com/webhook',
          events: ['WORKFLOW_EXECUTION_COMPLETED'],
        })
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should isolate webhooks by workspace', async () => {
      // Create another user and workspace
      const workspace2 = await WorkspaceModel.create({
        name: 'Other Workspace',
        slug: 'other-workspace',
        ownerId: new mongoose.Types.ObjectId(),
      });

      const user2 = await UserModel.create({
        email: 'user2@example.com',
        passwordHash: 'hash',
        defaultWorkspaceId: workspace2._id,
      });

      await WorkspaceMemberModel.create({
        workspaceId: workspace2._id,
        userId: user2._id,
        role: 'ADMIN',
        permissions: permissionsForRole('ADMIN'),
        status: 'ACTIVE',
      });

      const accessToken2 = signAccessToken(
        authConfig,
        { userId: user2._id.toString(), email: user2.email },
      );

      const webhook = await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Workspace 1 Hook',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: 'enc.iv.tag',
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      // Try to access workspace 1's webhook from user in workspace 2
      await request(app)
        .get(`/api/v1/webhooks/${webhook._id.toString()}`)
        .set('Authorization', `Bearer ${accessToken2}`)
        .expect(404);
    });
  });

  describe('Webhook Dispatching', () => {
    it('should dispatch events to matching webhooks', async () => {
      const secret = encryptSecret('secret1');
      await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Hook 1',
        url: 'https://example.com/webhook1',
        events: ['WORKFLOW_EXECUTION_STARTED', 'WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: `${secret.encryptedData}.${secret.iv}.${secret.tag}`,
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      const workflow = await WorkflowModel.create({
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        latestVersionNumber: 1,
      });

      const execution = await WorkflowExecutionModel.create({
        workflowId: workflow._id,
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        workflowVersionId: new mongoose.Types.ObjectId(),
        versionNumber: 1,
        jobId: 'test-job-1',
        idempotencyKey: 'test-idem-1',
        inputHash: 'hash1',
        status: 'RUNNING',
        input: { test: 'data' },
        attemptsMade: 0,
        statusHistory: [{ status: 'RUNNING', timestamp: new Date() }],
      });

      await dispatchExecutionStarted(mockQueue, execution);

      expect(enqueuedJobs).toHaveLength(1);
      expect(enqueuedJobs[0]!.data.deliveryId).toBeTruthy();

      const delivery = await WebhookDeliveryModel.findById(enqueuedJobs[0]!.data.deliveryId);
      expect(delivery).toBeTruthy();
      expect(delivery!.event).toBe('WORKFLOW_EXECUTION_STARTED');
      expect(delivery!.status).toBe('PENDING');

      const payload = JSON.parse(delivery!.payload);
      expect(payload.event).toBe('WORKFLOW_EXECUTION_STARTED');
      expect(payload.executionId).toBe(execution._id.toString());
      expect(payload.workflowId).toBe(workflow._id.toString());
      expect(payload.input).toEqual({ test: 'data' });
    });

    it('should not dispatch to PAUSED webhooks', async () => {
      await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Paused Hook',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: 'enc.iv.tag',
        status: 'PAUSED',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      const workflow = await WorkflowModel.create({
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        latestVersionNumber: 1,
      });

      const execution = await WorkflowExecutionModel.create({
        workflowId: workflow._id,
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        workflowVersionId: new mongoose.Types.ObjectId(),
        versionNumber: 1,
        jobId: 'test-job-2',
        idempotencyKey: 'test-idem-2',
        inputHash: 'hash2',
        status: 'SUCCEEDED',
        input: {},
        result: { success: true },
        attemptsMade: 1,
        statusHistory: [{ status: 'SUCCEEDED', timestamp: new Date() }],
      });

      await dispatchExecutionCompleted(mockQueue, execution);

      expect(enqueuedJobs).toHaveLength(0);
    });

    it('should dispatch to multiple matching webhooks', async () => {
      const secret1 = encryptSecret('secret1');
      const secret2 = encryptSecret('secret2');

      await WebhookModel.create([
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          name: 'Hook 1',
          url: 'https://example.com/webhook1',
          events: ['WORKFLOW_EXECUTION_COMPLETED'],
          encryptedSecret: `${secret1.encryptedData}.${secret1.iv}.${secret1.tag}`,
          status: 'ACTIVE',
          createdBy: new mongoose.Types.ObjectId(userId),
        },
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          name: 'Hook 2',
          url: 'https://example.com/webhook2',
          events: ['WORKFLOW_EXECUTION_COMPLETED'],
          encryptedSecret: `${secret2.encryptedData}.${secret2.iv}.${secret2.tag}`,
          status: 'ACTIVE',
          createdBy: new mongoose.Types.ObjectId(userId),
        },
      ]);

      const workflow = await WorkflowModel.create({
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        latestVersionNumber: 1,
      });

      const execution = await WorkflowExecutionModel.create({
        workflowId: workflow._id,
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        workflowVersionId: new mongoose.Types.ObjectId(),
        versionNumber: 1,
        jobId: 'test-job-3',
        idempotencyKey: 'test-idem-3',
        inputHash: 'hash3',
        status: 'SUCCEEDED',
        input: {},
        result: { done: true },
        attemptsMade: 1,
        statusHistory: [{ status: 'SUCCEEDED', timestamp: new Date() }],
      });

      await dispatchExecutionCompleted(mockQueue, execution);

      expect(enqueuedJobs).toHaveLength(2);
    });
  });

  describe('Delivery Management', () => {
    it('should list webhook deliveries', async () => {
      const webhook = await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Test Hook',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: 'enc.iv.tag',
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      await WebhookDeliveryModel.create([
        {
          webhookId: webhook._id,
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          event: 'WORKFLOW_EXECUTION_COMPLETED',
          payload: JSON.stringify({ test: 1 }),
          status: 'DELIVERED',
          attempts: 1,
          maxAttempts: 5,
          responseCode: 200,
          durationMs: 150,
          createdAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        {
          webhookId: webhook._id,
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          event: 'WORKFLOW_EXECUTION_COMPLETED',
          payload: JSON.stringify({ test: 2 }),
          status: 'FAILED',
          attempts: 5,
          maxAttempts: 5,
          responseCode: 500,
          durationMs: 300,
          createdAt: new Date('2026-01-02T10:00:00.000Z'),
        },
      ]);

      const response = await request(app)
        .get(`/api/v1/webhooks/${webhook._id.toString()}/deliveries`)
        .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].status).toBe('FAILED'); // Sorted by createdAt desc
      expect(response.body[1].status).toBe('DELIVERED');
    });

    it('should retry failed webhook delivery', async () => {
      const webhook = await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Test Hook',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: 'enc.iv.tag',
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      const delivery = await WebhookDeliveryModel.create({
        webhookId: webhook._id,
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        event: 'WORKFLOW_EXECUTION_COMPLETED',
        payload: JSON.stringify({ test: 'data' }),
        status: 'FAILED',
        attempts: 5,
        maxAttempts: 5,
        responseCode: 503,
      });

      await request(app)
        .post(`/api/v1/webhooks/${webhook._id.toString()}/deliveries/${delivery._id.toString()}/retry`)
        .set('Authorization', `Bearer ${accessToken}`)
                .expect(202);

      const updated = await WebhookDeliveryModel.findById(delivery._id);
      expect(updated!.status).toBe('PENDING');
      expect(updated!.attempts).toBe(0);

      expect(enqueuedJobs).toHaveLength(1);
      expect(enqueuedJobs[0]!.data.deliveryId).toBe(delivery._id.toString());
    });

    it('should not retry non-failed deliveries', async () => {
      const webhook = await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Test Hook',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: 'enc.iv.tag',
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      const delivery = await WebhookDeliveryModel.create({
        webhookId: webhook._id,
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        event: 'WORKFLOW_EXECUTION_COMPLETED',
        payload: JSON.stringify({ test: 'data' }),
        status: 'DELIVERED',
        attempts: 1,
        maxAttempts: 5,
        responseCode: 200,
      });

      const response = await request(app)
        .post(`/api/v1/webhooks/${webhook._id.toString()}/deliveries/${delivery._id.toString()}/retry`)
        .set('Authorization', `Bearer ${accessToken}`)
                .expect(409);

      expect(response.body.error.code).toBe('WEBHOOK_DELIVERY_NOT_FAILED');
    });
  });

  describe('Payload Structure', () => {
    it('should include all required fields in STARTED event payload', async () => {
      const secret = encryptSecret('secret');
      await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Test Hook',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_STARTED'],
        encryptedSecret: `${secret.encryptedData}.${secret.iv}.${secret.tag}`,
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      const workflow = await WorkflowModel.create({
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        latestVersionNumber: 1,
      });

      const execution = await WorkflowExecutionModel.create({
        workflowId: workflow._id,
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        workflowVersionId: new mongoose.Types.ObjectId(),
        versionNumber: 1,
        jobId: 'test-job-4',
        idempotencyKey: 'test-idem-4',
        inputHash: 'hash4',
        status: 'RUNNING',
        input: { key: 'value' },
        startedAt: new Date(),
        attemptsMade: 0,
        statusHistory: [{ status: 'RUNNING', timestamp: new Date() }],
      });

      await dispatchExecutionStarted(mockQueue, execution);

      const delivery = await WebhookDeliveryModel.findById(enqueuedJobs[0]!.data.deliveryId);
      const payload = JSON.parse(delivery!.payload);

      expect(payload).toMatchObject({
        event: 'WORKFLOW_EXECUTION_STARTED',
        workflowId: workflow._id.toString(),
        executionId: execution._id.toString(),
        workspaceId: workspaceId,
        versionNumber: 1,
        status: 'RUNNING',
        input: { key: 'value' },
      });
      expect(payload.timestamp).toBeTruthy();
      expect(payload.createdAt).toBeTruthy();
      expect(payload.startedAt).toBeTruthy();
    });

    it('should include result in COMPLETED event payload', async () => {
      const workflow = await WorkflowModel.create({
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        latestVersionNumber: 1,
      });

      const execution = await WorkflowExecutionModel.create({
        workflowId: workflow._id,
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        ownerId: new mongoose.Types.ObjectId(userId),
        workflowVersionId: new mongoose.Types.ObjectId(),
        versionNumber: 1,
        jobId: 'test-job-5',
        idempotencyKey: 'test-idem-5',
        inputHash: 'hash5',
        status: 'SUCCEEDED',
        input: {},
        result: { output: 'success', count: 42 },
        startedAt: new Date(),
        finishedAt: new Date(),
        attemptsMade: 1,
        statusHistory: [{ status: 'SUCCEEDED', timestamp: new Date() }],
      });

      const secret = encryptSecret('secret');
      await WebhookModel.create({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        name: 'Test Hook',
        url: 'https://example.com/webhook',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        encryptedSecret: `${secret.encryptedData}.${secret.iv}.${secret.tag}`,
        status: 'ACTIVE',
        createdBy: new mongoose.Types.ObjectId(userId),
      });

      await dispatchExecutionCompleted(mockQueue, execution);

      const delivery = await WebhookDeliveryModel.findById(enqueuedJobs[0]!.data.deliveryId);
      const payload = JSON.parse(delivery!.payload);

      expect(payload.result).toEqual({ output: 'success', count: 42 });
      expect(payload.finishedAt).toBeTruthy();
    });
  });
});

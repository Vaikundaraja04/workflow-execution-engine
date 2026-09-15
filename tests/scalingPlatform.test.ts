import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { WebhookModel } from '../src/models/WebhookModel.js';
import { WebhookDeliveryModel } from '../src/models/WebhookDeliveryModel.js';
import { DeadLetterModel } from '../src/models/DeadLetterModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import type { ExecutionQueue, QueueMetrics } from '../src/queues/executionQueue.js';
import type { WebhookQueue } from '../src/queues/webhookQueue.js';
import { createQueueManagementService } from '../src/services/queueManagementService.js';
import { getWorkerPoolMetrics } from '../src/services/adminService.js';
import {
  runDataRetention,
  getEffectiveRetentionPolicy,
  DEFAULT_RETENTION_POLICY,
} from '../src/services/retentionService.js';
import {
  getDatabaseOptimizationReport,
} from '../src/services/databaseOptimizationService.js';
import {
  getMaintenanceMode,
  setMaintenanceMode,
  createDisasterRecoverySnapshot,
  validateDisasterRecoverySnapshot,
} from '../src/services/disasterRecoveryService.js';
import {
  cancelWorkflowExecution,
  retryWorkflowExecution,
} from '../src/services/executionService.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-scaling-platform-tests-5b',
  accessTtl: '15m',
  refreshTtl: '7d',
};

// Mock In-Memory Queues
class MockExecutionQueue implements ExecutionQueue {
  public isPausedState = false;
  public enqueuedJobs: any[] = [];
  public counts = { waiting: 2, active: 1, delayed: 0, failed: 0, completed: 5, paused: 0 };

  async enqueue(data: any, options: any): Promise<void> {
    this.enqueuedJobs.push({ data, options });
  }

  async close(): Promise<void> {}

  async pause(): Promise<void> {
    this.isPausedState = true;
  }

  async resume(): Promise<void> {
    this.isPausedState = false;
  }

  async isPaused(): Promise<boolean> {
    return this.isPausedState;
  }

  async getMetrics(): Promise<QueueMetrics> {
    return {
      name: 'workflow-executions',
      isPaused: this.isPausedState,
      counts: { ...this.counts, paused: this.isPausedState ? this.counts.waiting : 0 },
      total: Object.values(this.counts).reduce((a, b) => a + b, 0),
    };
  }

  async removeJob(jobId: string): Promise<boolean> {
    const idx = this.enqueuedJobs.findIndex(j => j.options?.jobId === jobId);
    if (idx >= 0) {
      this.enqueuedJobs.splice(idx, 1);
      return true;
    }
    return true;
  }

  async retryJob(_jobId: string): Promise<boolean> {
    return true;
  }
}

class MockWebhookQueue implements WebhookQueue {
  public isPausedState = false;
  public enqueuedJobs: any[] = [];
  public counts = { waiting: 1, active: 0, delayed: 0, failed: 1, completed: 10, paused: 0 };

  async enqueue(data: any, options: any): Promise<void> {
    this.enqueuedJobs.push({ data, options });
  }

  async close(): Promise<void> {}

  async pause(): Promise<void> {
    this.isPausedState = true;
  }

  async resume(): Promise<void> {
    this.isPausedState = false;
  }

  async isPaused(): Promise<boolean> {
    return this.isPausedState;
  }

  async getMetrics(): Promise<QueueMetrics> {
    return {
      name: 'webhook-delivery',
      isPaused: this.isPausedState,
      counts: { ...this.counts, paused: this.isPausedState ? this.counts.waiting : 0 },
      total: Object.values(this.counts).reduce((a, b) => a + b, 0),
    };
  }

  async removeJob(_jobId: string): Promise<boolean> {
    return true;
  }
}

let mockExecutionQueue: MockExecutionQueue;
let mockWebhookQueue: MockWebhookQueue;

// Test users and tokens
let ownerUser: any;
let adminUser: any;
let editorUser: any;
let viewerUser: any;
let foreignUser: any;

let ownerToken: string;
let adminToken: string;
let editorToken: string;
let viewerToken: string;
let foreignToken: string;

let workspaceA: any;
let workspaceAId: string;
let testWorkflow: any;
let testWorkflowVersion: any;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  mockExecutionQueue = new MockExecutionQueue();
  mockWebhookQueue = new MockWebhookQueue();

  const app = createApp({
    auth: authConfig,
    docs: true,
    executionQueue: mockExecutionQueue,
    webhookQueue: mockWebhookQueue,
    health: {
      checks: {
        mongo: async () => ({ status: 'up', latencyMs: 1 }),
        redis: async () => ({ status: 'up', latencyMs: 1 }),
        worker: async () => ({ status: 'up', latencyMs: 2 }),
      },
    },
  });
  request = supertest(app);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
  await APIKeyModel.deleteMany({});
  await WebhookModel.deleteMany({});
  await WebhookDeliveryModel.deleteMany({});
  await DeadLetterModel.deleteMany({});
  await AuditLogModel.deleteMany({});

  mockExecutionQueue.isPausedState = false;
  mockExecutionQueue.enqueuedJobs = [];
  mockWebhookQueue.isPausedState = false;
  mockWebhookQueue.enqueuedJobs = [];

  const hashedPassword = await hashPassword('TestPassword123!');

  ownerUser = await UserModel.create({
    email: 'owner@example.com',
    passwordHash: hashedPassword,
  });
  adminUser = await UserModel.create({
    email: 'admin@example.com',
    passwordHash: hashedPassword,
  });
  editorUser = await UserModel.create({
    email: 'editor@example.com',
    passwordHash: hashedPassword,
  });
  viewerUser = await UserModel.create({
    email: 'viewer@example.com',
    passwordHash: hashedPassword,
  });
  foreignUser = await UserModel.create({
    email: 'foreign@example.com',
    passwordHash: hashedPassword,
  });

  workspaceA = await WorkspaceModel.create({
    name: 'Workspace Alpha',
    slug: 'workspace-alpha',
    ownerId: ownerUser._id,
    status: 'ACTIVE',
  });
  workspaceAId = workspaceA._id.toString();

  await WorkspaceMemberModel.create([
    {
      workspaceId: workspaceA._id,
      userId: ownerUser._id,
      role: 'OWNER',
      permissions: permissionsForRole('OWNER'),
      status: 'ACTIVE',
    },
    {
      workspaceId: workspaceA._id,
      userId: adminUser._id,
      role: 'ADMIN',
      permissions: permissionsForRole('ADMIN'),
      status: 'ACTIVE',
    },
    {
      workspaceId: workspaceA._id,
      userId: editorUser._id,
      role: 'EDITOR',
      permissions: permissionsForRole('EDITOR'),
      status: 'ACTIVE',
    },
    {
      workspaceId: workspaceA._id,
      userId: viewerUser._id,
      role: 'VIEWER',
      permissions: permissionsForRole('VIEWER'),
      status: 'ACTIVE',
    },
  ]);

  ownerToken = signAccessToken(authConfig, { userId: ownerUser._id.toString(), email: ownerUser.email });
  adminToken = signAccessToken(authConfig, { userId: adminUser._id.toString(), email: adminUser.email });
  editorToken = signAccessToken(authConfig, { userId: editorUser._id.toString(), email: editorUser.email });
  viewerToken = signAccessToken(authConfig, { userId: viewerUser._id.toString(), email: viewerUser.email });
  foreignToken = signAccessToken(authConfig, { userId: foreignUser._id.toString(), email: foreignUser.email });

  testWorkflow = await WorkflowModel.create({
    name: 'Alpha Workflow',
    ownerId: ownerUser._id,
    workspaceId: workspaceA._id,
    status: 'PUBLISHED',
    latestVersionNumber: 1,
    draftDefinition: {
      nodes: [
        { id: 'start', type: 'webhook', config: { url: 'https://example.com' } },
        { id: 'end', type: 'log', config: { message: 'done' } },
      ],
      edges: [{ source: 'start', target: 'end' }],
    },
  });

  testWorkflowVersion = await WorkflowVersionModel.create({
    workflowId: testWorkflow._id,
    workspaceId: workspaceA._id,
    versionNumber: 1,
    status: 'PUBLISHED',
    definition: testWorkflow.draftDefinition,
    definitionHash: 'hash-v1',
    createdBy: ownerUser._id,
  });

  testWorkflow.publishedVersionId = testWorkflowVersion._id;
  await testWorkflow.save();
});

describe('PHASE 5B: Enterprise Reliability & Scaling', () => {
  // =========================================================================
  // 1. Distributed Worker Management (Metrics-Only Autoscaling)
  // =========================================================================
  describe('1. Distributed Worker Management & Autoscaling Metrics', () => {
    it('returns worker pool status and autoscaling metrics via admin endpoint', async () => {
      const res = await request
        .get('/api/v1/admin/system/workers/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(['HEALTHY', 'DEGRADED', 'NO_WORKERS']).toContain(res.body.status);
      expect(res.body).toHaveProperty('activeWorkers');
      expect(res.body).toHaveProperty('totalWorkers');
      expect(res.body).toHaveProperty('staleWorkers');
      expect(res.body).toHaveProperty('heartbeatStatus');
      expect(res.body).toHaveProperty('heartbeatLatencyMs');
      expect(res.body).toHaveProperty('queueDepth');
      expect(res.body.queueDepth).toHaveProperty('executions');
      expect(res.body.queueDepth).toHaveProperty('webhooks');
      expect(res.body.queueDepth).toHaveProperty('total');
      expect(res.body).toHaveProperty('scalingRecommendation');
      expect(res.body.scalingRecommendation).toHaveProperty('currentReplicas');
      expect(res.body.scalingRecommendation).toHaveProperty('recommendedReplicas');
      expect(res.body.scalingRecommendation).toHaveProperty('action');
      expect(['SCALE_UP', 'SCALE_DOWN', 'MAINTAIN']).toContain(res.body.scalingRecommendation.action);
      expect(res.body.scalingRecommendation).toHaveProperty('targetBacklogPerWorker');
    });

    it('supports alias GET /api/v1/admin/system/workers and /workers/metrics', async () => {
      const res1 = await request
        .get('/api/v1/admin/system/workers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(res1.body).toHaveProperty('scalingRecommendation');

      const res2 = await request
        .get('/api/v1/admin/workers/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(res2.body).toHaveProperty('scalingRecommendation');
    });

    it('calculates scale up recommendations when queue backlog exceeds target thresholds', async () => {
      // Simulate heavy queue backlog
      mockExecutionQueue.counts = { waiting: 150, active: 10, delayed: 20, failed: 0, completed: 50, paused: 0 };
      mockWebhookQueue.counts = { waiting: 80, active: 5, delayed: 0, failed: 2, completed: 30, paused: 0 };

      const metrics = await getWorkerPoolMetrics(
        {
          mongo: async () => ({ status: 'up', latencyMs: 1 }),
          redis: async () => ({ status: 'up', latencyMs: 1 }),
          worker: async () => ({ status: 'up', latencyMs: 2 }),
        },
        mockExecutionQueue,
        mockWebhookQueue,
      );

      expect(metrics.queueDepth.total).toBe(150 + 20 + 80);
      expect(metrics.scalingRecommendation.action).toBe('SCALE_UP');
      expect(metrics.scalingRecommendation.recommendedReplicas).toBeGreaterThan(1);
    });

    it('handles down worker pool with pending backlog appropriately', async () => {
      mockExecutionQueue.counts = { waiting: 100, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 };
      const metrics = await getWorkerPoolMetrics(
        {
          mongo: async () => ({ status: 'up', latencyMs: 1 }),
          redis: async () => ({ status: 'up', latencyMs: 1 }),
          worker: async () => ({ status: 'down', latencyMs: 0, detail: 'heartbeat lost' }),
        },
        mockExecutionQueue,
        mockWebhookQueue,
      );

      expect(metrics.status).toBe('NO_WORKERS');
      expect(metrics.scalingRecommendation.action).toBe('SCALE_UP');
    });
  });

  // =========================================================================
  // 2. Queue Monitoring & Management APIs
  // =========================================================================
  describe('2. Queue Monitoring & Queue Control APIs', () => {
    it('GET /api/v1/admin/queues returns metrics across execution and webhook queues', async () => {
      const res = await request
        .get('/api/v1/admin/queues')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(res.body).toHaveProperty('execution');
      expect(res.body.execution.name).toBe('workflow-executions');
      expect(res.body.execution.counts).toHaveProperty('waiting');
      expect(res.body.execution.counts).toHaveProperty('active');

      expect(res.body).toHaveProperty('webhook');
      expect(res.body.webhook.name).toBe('webhook-delivery');
      expect(res.body.webhook.counts).toHaveProperty('waiting');
      expect(Array.isArray(res.body.queues)).toBe(true);
    });

    it('GET /api/v1/admin/queues/:queueName returns metrics for specified queue', async () => {
      const execRes = await request
        .get('/api/v1/admin/queues/execution')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(execRes.body.name).toBe('workflow-executions');

      const webhookRes = await request
        .get('/api/v1/admin/queues/webhook-delivery')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(webhookRes.body.name).toBe('webhook-delivery');

      const metricsAliasRes = await request
        .get('/api/v1/admin/queues/execution/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(metricsAliasRes.body.name).toBe('workflow-executions');
    });

    it('POST /api/v1/admin/queues/:queueName/pause and /resume controls queues and records audit log', async () => {
      expect(mockExecutionQueue.isPausedState).toBe(false);

      // 1. Pause execution queue
      const pauseRes = await request
        .post('/api/v1/admin/queues/execution/pause')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(pauseRes.body).toEqual({ success: true, queue: 'execution', paused: true });
      expect(mockExecutionQueue.isPausedState).toBe(true);

      const pauseAudit = await AuditLogModel.findOne({ action: 'QUEUE_PAUSED', resourceId: 'execution' });
      expect(pauseAudit).not.toBeNull();
      expect(pauseAudit?.userId?.toString()).toBe(adminUser._id.toString());

      // 2. Resume execution queue
      const resumeRes = await request
        .post('/api/v1/admin/queues/execution/resume')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(resumeRes.body).toEqual({ success: true, queue: 'execution', paused: false });
      expect(mockExecutionQueue.isPausedState).toBe(false);

      const resumeAudit = await AuditLogModel.findOne({ action: 'QUEUE_RESUMED', resourceId: 'execution' });
      expect(resumeAudit).not.toBeNull();

      // 3. Pause webhook queue
      const pauseWhRes = await request
        .post('/api/v1/admin/queues/webhook/pause')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(pauseWhRes.body).toEqual({ success: true, queue: 'webhook', paused: true });
      expect(mockWebhookQueue.isPausedState).toBe(true);

      // 4. Resume webhook queue
      const resumeWhRes = await request
        .post('/api/v1/admin/queues/webhook/resume')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(resumeWhRes.body).toEqual({ success: true, queue: 'webhook', paused: false });
      expect(mockWebhookQueue.isPausedState).toBe(false);
    });

    it('service unit test: QueueManagementService handles operations safely', async () => {
      const qService = createQueueManagementService(mockExecutionQueue, mockWebhookQueue);

      const execMetrics = await qService.getExecutionQueueMetrics();
      expect(execMetrics.name).toBe('workflow-executions');

      const whMetrics = await qService.getWebhookQueueMetrics();
      expect(whMetrics.name).toBe('webhook-delivery');

      await qService.pauseExecutionQueue();
      expect(await qService.isExecutionQueuePaused()).toBe(true);

      await qService.resumeExecutionQueue();
      expect(await qService.isExecutionQueuePaused()).toBe(false);

      expect(await qService.removeExecutionJob('non-existent')).toBe(true);
      expect(await qService.retryExecutionJob('test-job')).toBe(true);
      expect(await qService.removeWebhookJob('test-wh-job')).toBe(true);
    });
  });

  // =========================================================================
  // 3. Execution Control APIs (Cancel & Manual Retry)
  // =========================================================================
  describe('3. Execution Control APIs (Cancel & Retry)', () => {
    let queuedExecution: any;
    let runningExecution: any;
    let succeededExecution: any;
    let failedExecution: any;

    beforeEach(async () => {
      queuedExecution = await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-queued-${Date.now()}`,
        idempotencyKey: `idem-queued-${Date.now()}`,
        inputHash: 'input-hash-1',
        input: { a: 1 },
        status: 'QUEUED',
        attemptsMade: 0,
        statusHistory: [{ status: 'QUEUED', timestamp: new Date() }],
      });

      runningExecution = await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-running-${Date.now()}`,
        idempotencyKey: `idem-running-${Date.now()}`,
        inputHash: 'input-hash-2',
        input: { a: 2 },
        status: 'RUNNING',
        attemptsMade: 1,
        startedAt: new Date(),
        statusHistory: [
          { status: 'QUEUED', timestamp: new Date() },
          { status: 'RUNNING', timestamp: new Date(), attempt: 1 },
        ],
      });

      succeededExecution = await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-succeeded-${Date.now()}`,
        idempotencyKey: `idem-succeeded-${Date.now()}`,
        inputHash: 'input-hash-3',
        input: { a: 3 },
        status: 'SUCCEEDED',
        attemptsMade: 1,
        result: { status: 'SUCCEEDED', outputs: { out: true } },
        finishedAt: new Date(),
        statusHistory: [
          { status: 'QUEUED', timestamp: new Date() },
          { status: 'RUNNING', timestamp: new Date(), attempt: 1 },
          { status: 'SUCCEEDED', timestamp: new Date(), attempt: 1 },
        ],
      });

      failedExecution = await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-failed-${Date.now()}`,
        idempotencyKey: `idem-failed-${Date.now()}`,
        inputHash: 'input-hash-4',
        input: { a: 4 },
        status: 'FAILED',
        attemptsMade: 3,
        maxRetries: 2,
        retryCount: 2,
        error: { code: 'EXECUTION_TIMEOUT', message: 'Step timed out' },
        finishedAt: new Date(),
        statusHistory: [
          { status: 'QUEUED', timestamp: new Date() },
          { status: 'FAILED', timestamp: new Date(), attempt: 3 },
        ],
      });

      await DeadLetterModel.create({
        executionId: failedExecution._id,
        workflowId: testWorkflow._id,
        workspaceId: workspaceA._id,
        failureReason: 'EXECUTION_TIMEOUT',
        message: 'Step timed out',
        attempts: 3,
        failedAt: new Date(),
      });
    });

    it('cancels a queued execution via Admin API and emits audit log', async () => {
      const res = await request
        .post(`/api/v1/admin/executions/${queuedExecution._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ reason: 'Manual intervention by administrator' })
        .expect(200);

      expect(res.body.executionId).toBe(queuedExecution._id.toString());
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.code).toBe('EXECUTION_CANCELLED');
      expect(res.body.error.message).toContain('Manual intervention by administrator');

      const updated = await WorkflowExecutionModel.findById(queuedExecution._id);
      expect(updated?.status).toBe('FAILED');
      expect(updated?.finishedAt).toBeDefined();

      const audit = await AuditLogModel.findOne({ action: 'EXECUTION_CANCELLED', resourceId: queuedExecution._id.toString() });
      expect(audit).not.toBeNull();
      expect(audit?.userId?.toString()).toBe(adminUser._id.toString());
    });

    it('cancels a running execution via standard execution endpoint', async () => {
      const res = await request
        .post(`/api/executions/${runningExecution._id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ reason: 'Cancelled by workflow owner' })
        .expect(200);

      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.code).toBe('EXECUTION_CANCELLED');

      const audit = await AuditLogModel.findOne({ action: 'EXECUTION_CANCELLED', resourceId: runningExecution._id.toString() });
      expect(audit).not.toBeNull();
      expect(audit?.userId?.toString()).toBe(ownerUser._id.toString());
    });

    it('rejects cancellation of an already SUCCEEDED execution with 409', async () => {
      await request
        .post(`/api/v1/admin/executions/${succeededExecution._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(409);
    });

    it('retries a FAILED execution via Admin API, re-queuing and cleaning up dead letters', async () => {
      const res = await request
        .post(`/api/v1/admin/executions/${failedExecution._id}/retry`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ timeoutMs: 45000 })
        .expect(200);

      expect(res.body.executionId).toBe(failedExecution._id.toString());
      expect(['QUEUING', 'QUEUED']).toContain(res.body.status);
      expect(res.body.retryCount).toBe(3);
      expect(res.body.error).toBeUndefined();

      // Verify dead letter removed
      const deadLetter = await DeadLetterModel.findOne({ executionId: failedExecution._id });
      expect(deadLetter).toBeNull();

      // Verify re-enqueue
      expect(mockExecutionQueue.enqueuedJobs.length).toBeGreaterThan(0);
      const lastJob = mockExecutionQueue.enqueuedJobs[mockExecutionQueue.enqueuedJobs.length - 1];
      expect(lastJob.data.executionId).toBe(failedExecution._id.toString());

      // Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'EXECUTION_RETRIED', resourceId: failedExecution._id.toString() });
      expect(audit).not.toBeNull();
      expect(audit?.userId?.toString()).toBe(adminUser._id.toString());
    });

    it('retries a FAILED execution via standard execution endpoint', async () => {
      const res = await request
        .post(`/api/executions/${failedExecution._id}/retry`)
        .set('Authorization', `Bearer ${editorToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(res.body.executionId).toBe(failedExecution._id.toString());
      expect(['QUEUING', 'QUEUED']).toContain(res.body.status);
    });

    it('rejects retrying an execution that is currently RUNNING or SUCCEEDED with 409', async () => {
      await request
        .post(`/api/executions/${runningExecution._id}/retry`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(409);

      await request
        .post(`/api/executions/${succeededExecution._id}/retry`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(409);
    });
  });

  // =========================================================================
  // 4. Database Optimization Review
  // =========================================================================
  describe('4. Database Optimization Review API', () => {
    it('GET /api/v1/admin/system/database/optimization returns index analysis across collections', async () => {
      const res = await request
        .get('/api/v1/admin/system/database/optimization')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('databaseName');
      expect(res.body).toHaveProperty('connectionState');
      expect(res.body).toHaveProperty('collections');
      expect(Array.isArray(res.body.collections)).toBe(true);
      expect(res.body.collections.length).toBeGreaterThan(0);

      const execCollection = res.body.collections.find((c: any) => c.collection === 'workflowexecutions');
      expect(execCollection).toBeDefined();
      expect(execCollection).toHaveProperty('documentCount');
      expect(execCollection).toHaveProperty('indexes');
      expect(execCollection).toHaveProperty('recommendedIndexes');
      expect(execCollection).toHaveProperty('status');

      expect(res.body).toHaveProperty('totalIndexes');
      expect(res.body).toHaveProperty('summary');
      expect(res.body.summary).toHaveProperty('status');
      expect(res.body.summary).toHaveProperty('recommendationsCount');
    });

    it('supports alias endpoint /api/v1/admin/database/optimization', async () => {
      const res = await request
        .get('/api/v1/admin/database/optimization')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(res.body).toHaveProperty('collections');
    });

    it('service function getDatabaseOptimizationReport runs directly', async () => {
      const report = await getDatabaseOptimizationReport();
      expect(report.collections.length).toBeGreaterThan(0);
      expect(report.totalIndexes).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 5. Data Retention Framework
  // =========================================================================
  describe('5. Data Retention Framework', () => {
    const oldTimestamp = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const recentTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

    beforeEach(async () => {
      // 1. Old Succeeded execution (should be purged)
      await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-old-succ-${Date.now()}`,
        idempotencyKey: `idem-old-succ-${Date.now()}`,
        inputHash: 'hash-old-succ',
        input: {},
        status: 'SUCCEEDED',
        attemptsMade: 1,
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      });

      // 2. Old Failed execution (should be purged)
      await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-old-fail-${Date.now()}`,
        idempotencyKey: `idem-old-fail-${Date.now()}`,
        inputHash: 'hash-old-fail',
        input: {},
        status: 'FAILED',
        attemptsMade: 3,
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      });

      // 3. Old RUNNING execution (should NEVER be purged - active work safety)
      await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-old-run-${Date.now()}`,
        idempotencyKey: `idem-old-run-${Date.now()}`,
        inputHash: 'hash-old-run',
        input: {},
        status: 'RUNNING',
        attemptsMade: 1,
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      });

      // 4. Recent execution (should be retained)
      await WorkflowExecutionModel.create({
        workflowId: testWorkflow._id,
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        workflowVersionId: testWorkflowVersion._id,
        versionNumber: 1,
        jobId: `job-recent-${Date.now()}`,
        idempotencyKey: `idem-recent-${Date.now()}`,
        inputHash: 'hash-recent',
        input: {},
        status: 'SUCCEEDED',
        attemptsMade: 1,
        createdAt: recentTimestamp,
        updatedAt: recentTimestamp,
      });

      // 5. Old Audit Logs & Webhook Deliveries & Dead letters
      await AuditLogModel.create({
        action: 'AUTH_LOGIN_SUCCESS',
        userId: ownerUser._id,
        workspaceId: workspaceA._id,
        createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // 400 days ago
      });

      await WebhookDeliveryModel.create({
        webhookId: new Types.ObjectId(),
        workspaceId: workspaceA._id,
        event: 'WORKFLOW_EXECUTION_COMPLETED',
        payload: JSON.stringify({ executionId: 'exec_123' }),
        status: 'DELIVERED',
        attempts: 1,
        createdAt: oldTimestamp,
      });

      await DeadLetterModel.create({
        executionId: new Types.ObjectId(),
        workspaceId: workspaceA._id,
        failureReason: 'UNRECOVERABLE_ERROR',
        attempts: 3,
        failedAt: oldTimestamp,
      });
    });

    it('GET /api/v1/admin/system/retention/policies returns default policies', async () => {
      const res = await request
        .get('/api/v1/admin/system/retention/policies')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(res.body).toEqual(DEFAULT_RETENTION_POLICY);
    });

    it('POST /api/v1/admin/system/retention/run with dryRun=true previews counts without deleting documents', async () => {
      const execCountBefore = await WorkflowExecutionModel.countDocuments();
      const auditCountBefore = await AuditLogModel.countDocuments();

      const res = await request
        .post('/api/v1/admin/system/retention/run')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ dryRun: true, workspaceId: workspaceAId })
        .expect(200);

      expect(res.body.dryRun).toBe(true);
      expect(res.body.deletedCounts.executions).toBe(2); // 2 terminal old executions
      expect(res.body.deletedCounts.webhookDeliveries).toBe(1);
      expect(res.body.deletedCounts.deadLetters).toBe(1);

      // Verify no actual documents were deleted
      const execCountAfter = await WorkflowExecutionModel.countDocuments();
      const auditCountAfter = await AuditLogModel.countDocuments();
      expect(execCountAfter).toBe(execCountBefore);
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    it('POST /api/v1/admin/system/retention/run actually deletes expired records and records audit event', async () => {
      const res = await request
        .post('/api/v1/admin/system/retention/run')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({
          dryRun: false,
          workspaceId: workspaceAId,
          policies: { executionsRetentionDays: 90, auditLogsRetentionDays: 365, webhookDeliveriesRetentionDays: 90, deadLettersRetentionDays: 90 },
        })
        .expect(200);

      expect(res.body.dryRun).toBe(false);
      expect(res.body.deletedCounts.executions).toBe(2);
      expect(res.body.deletedCounts.auditLogs).toBe(1);
      expect(res.body.deletedCounts.webhookDeliveries).toBe(1);
      expect(res.body.deletedCounts.deadLetters).toBe(1);

      // Verify running execution and recent execution still exist
      const remainingExecutions = await WorkflowExecutionModel.find({ workspaceId: workspaceA._id });
      expect(remainingExecutions.length).toBe(2);
      const statuses = remainingExecutions.map(e => e.status);
      expect(statuses).toContain('RUNNING');
      expect(statuses).toContain('SUCCEEDED');

      // Verify audit log emitted
      const audit = await AuditLogModel.findOne({ action: 'DATA_RETENTION_EXECUTED' });
      expect(audit).not.toBeNull();
      expect(audit?.userId?.toString()).toBe(adminUser._id.toString());
    });
  });

  // =========================================================================
  // 6. Disaster Recovery Foundations (Snapshots & Maintenance Mode)
  // =========================================================================
  describe('6. Disaster Recovery Foundations & System Maintenance Mode', () => {
    it('GET /api/v1/admin/system/maintenance/mode returns current maintenance status', async () => {
      const res = await request
        .get('/api/v1/admin/system/maintenance/mode')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(res.body).toHaveProperty('enabled');
    });

    it('POST /api/v1/admin/system/maintenance/mode enables maintenance mode, pauses queues, and records audit log', async () => {
      expect(mockExecutionQueue.isPausedState).toBe(false);

      const enableRes = await request
        .post('/api/v1/admin/system/maintenance/mode')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ enabled: true, reason: 'Database failover drill', pauseQueues: true })
        .expect(200);

      expect(enableRes.body.enabled).toBe(true);
      expect(enableRes.body.reason).toBe('Database failover drill');
      expect(enableRes.body.enabledBy).toBe(adminUser._id.toString());
      expect(mockExecutionQueue.isPausedState).toBe(true);
      expect(mockWebhookQueue.isPausedState).toBe(true);

      const auditEnable = await AuditLogModel.findOne({ action: 'MAINTENANCE_MODE_UPDATED' });
      expect(auditEnable).not.toBeNull();

      // Disable maintenance mode
      const disableRes = await request
        .post('/api/v1/admin/system/maintenance/mode')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ enabled: false, pauseQueues: true })
        .expect(200);

      expect(disableRes.body.enabled).toBe(false);
      expect(mockExecutionQueue.isPausedState).toBe(false);
      expect(mockWebhookQueue.isPausedState).toBe(false);
    });

    it('POST /api/v1/admin/system/disaster-recovery/snapshot creates SHA-256 verified backup payload', async () => {
      const res = await request
        .post('/api/v1/admin/system/disaster-recovery/snapshot')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ workspaceId: workspaceAId })
        .expect(200);

      const snapshot = res.body;
      expect(snapshot.version).toBe('1.0.0');
      expect(snapshot.format).toBe('workflow-engine-backup-v1');
      expect(snapshot).toHaveProperty('checksum');
      expect(snapshot).toHaveProperty('data');
      expect(snapshot.data).toHaveProperty('workspaces');
      expect(snapshot.data).toHaveProperty('workflows');
      expect(snapshot.data).toHaveProperty('workflowVersions');
      expect(snapshot).toHaveProperty('counts');
      expect(snapshot.counts.workspaces).toBe(1);
      expect(snapshot.counts.workflows).toBe(1);

      const audit = await AuditLogModel.findOne({ action: 'DISASTER_RECOVERY_SNAPSHOT_CREATED' });
      expect(audit).not.toBeNull();
      expect(audit?.userId?.toString()).toBe(adminUser._id.toString());
    });

    it('POST /api/v1/admin/system/disaster-recovery/snapshot/validate verifies valid and tampered backups', async () => {
      // 1. Create a valid snapshot
      const snapshot = await createDisasterRecoverySnapshot({ workspaceId: workspaceAId });

      // Validate valid snapshot
      const validRes = await request
        .post('/api/v1/admin/system/disaster-recovery/snapshot/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ snapshot })
        .expect(200);

      expect(validRes.body.valid).toBe(true);
      expect(validRes.body.checksumValid).toBe(true);
      expect(validRes.body.countsMatch).toBe(true);
      expect(validRes.body.errors.length).toBe(0);

      // 2. Validate tampered snapshot (corrupted checksum)
      const tamperedSnapshot = { ...snapshot, checksum: 'corrupted-sha256-hash' };
      const invalidRes = await request
        .post('/api/v1/admin/system/disaster-recovery/snapshot/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ snapshot: tamperedSnapshot })
        .expect(200);

      expect(invalidRes.body.valid).toBe(false);
      expect(invalidRes.body.checksumValid).toBe(false);
      expect(invalidRes.body.errors.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 7. RBAC & Security Boundaries
  // =========================================================================
  describe('7. RBAC & Permission Boundaries for Phase 5B Features', () => {
    it('denies EDITOR and VIEWER users from administrative queue, scaling, retention, and DR endpoints', async () => {
      // Viewer attempts to pause queue
      await request
        .post('/api/v1/admin/queues/execution/pause')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);

      // Editor attempts to run retention
      await request
        .post('/api/v1/admin/system/retention/run')
        .set('Authorization', `Bearer ${editorToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ dryRun: true })
        .expect(403);

      // Viewer attempts to toggle maintenance mode
      await request
        .post('/api/v1/admin/system/maintenance/mode')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ enabled: true })
        .expect(403);

      // Viewer attempts to read worker metrics (insufficient permission)
      await request
        .get('/api/v1/admin/system/workers/metrics')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);

      // Non-member foreign user receives 404 (workspace isolation / information hiding)
      await request
        .get('/api/v1/admin/system/workers/metrics')
        .set('Authorization', `Bearer ${foreignToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(404);
    });

    it('denies unauthenticated requests on all admin endpoints with 401', async () => {
      await request.get('/api/v1/admin/queues').expect(401);
      await request.get('/api/v1/admin/system/database/optimization').expect(401);
      await request.post('/api/v1/admin/system/retention/run').expect(401);
      await request.post('/api/v1/admin/system/maintenance/mode').expect(401);
    });
  });
});

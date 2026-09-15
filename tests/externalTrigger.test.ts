import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/api/app.js';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { createAPIKey } from '../src/services/apiKeyService.js';
import type { ExecutionQueue, ExecutionJobData, ExecutionEnqueueOptions } from '../src/queues/executionQueue.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

interface RecordedJob {
  data: ExecutionJobData;
  options: ExecutionEnqueueOptions;
}

class RecordingQueue implements ExecutionQueue {
  jobs: RecordedJob[] = [];
  shouldFail = false;

  async enqueue(data: ExecutionJobData, options: ExecutionEnqueueOptions): Promise<void> {
    if (this.shouldFail) throw new Error('redis unavailable');
    this.jobs.push({ data, options });
  }

  async close(): Promise<void> {}
}

const queue = new RecordingQueue();
const workspaceId = new Types.ObjectId().toString();
const userId = new Types.ObjectId().toString();

function validDefinition(): WorkflowDefinition {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message: 'external-trigger' } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  };
}

async function createPublishedWorkflow(opts?: { workspaceId?: string; ownerId?: string }): Promise<string> {
  const wsId = opts?.workspaceId ?? workspaceId;
  const owner = opts?.ownerId ?? userId;
  const workflow = await WorkflowModel.create({
    name: 'Test Workflow',
    draftDefinition: validDefinition(),
    status: 'DRAFT',
    latestVersionNumber: 1,
    ownerId: new Types.ObjectId(owner),
    workspaceId: new Types.ObjectId(wsId),
  });
  const version = await WorkflowVersionModel.create({
    workflowId: workflow._id,
    versionNumber: 1,
    definition: validDefinition(),
  });
  workflow.status = 'PUBLISHED';
  workflow.publishedVersionId = version._id;
  await workflow.save();
  return workflow._id.toString();
}

let executeApiKey: string;
let readOnlyApiKey: string;
let request: ReturnType<typeof supertest>;
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  request = supertest(createApp({
    executionQueue: queue,
    executionCreationOptions: { attempts: 3, backoffMs: 10 },
    auth: authConfig,
    authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
  }));
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30_000);

beforeEach(async () => {
  queue.jobs = [];
  queue.shouldFail = false;
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await APIKeyModel.deleteMany({});
  await AuditLogModel.deleteMany({});

  const execKey = await createAPIKey(workspaceId, userId, 'Execute Key', ['WORKFLOW_EXECUTE']);
  executeApiKey = execKey.rawKey;
  const readOnlyKey = await createAPIKey(workspaceId, userId, 'Read Only', ['WORKFLOW_READ']);
  readOnlyApiKey = readOnlyKey.rawKey;
});

describe('External workflow trigger', () => {
  // ── Authentication ──

  it('triggers a workflow via API key and returns 202 with execution view', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'trigger-1', input: { foo: 'bar' } });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.executionId).toBeTruthy();
    expect(res.body.workflowId).toBe(workflowId);
    expect(res.body.versionNumber).toBe(1);
    expect(res.body.replayed).toBe(false);
    expect(queue.jobs).toHaveLength(1);
  });

  it('triggers a workflow via X-API-Key header', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('X-API-Key', executeApiKey)
      .send({ idempotencyKey: 'trigger-x-header', input: { foo: 'bar' } });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.executionId).toBeTruthy();
    expect(res.body.replayed).toBe(false);
    expect(queue.jobs).toHaveLength(1);
  });

  it('accepts a trigger with no input (defaults to empty object)', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'trigger-no-input' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.replayed).toBe(false);
    expect(queue.jobs).toHaveLength(1);
  });

  it('rejects missing authorization header', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .send({ idempotencyKey: 'no-auth' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an invalid API key', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', 'Bearer wke_invalidkey123')
      .send({ idempotencyKey: 'bad-key' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });

  it('rejects an expired API key with API_KEY_EXPIRED', async () => {
    const past = new Date(Date.now() - 1000);
    const expiredKey = await createAPIKey(workspaceId, userId, 'Expired', ['WORKFLOW_EXECUTE'], past);
    const workflowId = await createPublishedWorkflow();

    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${expiredKey.rawKey}`)
      .send({ idempotencyKey: 'expired-key' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('API_KEY_EXPIRED');
  });

  it('rejects a revoked API key', async () => {
    const revokedKey = await createAPIKey(workspaceId, userId, 'Revoked', ['WORKFLOW_EXECUTE']);
    await APIKeyModel.findByIdAndUpdate(revokedKey.key.id, {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedBy: new Types.ObjectId(userId),
    });
    const workflowId = await createPublishedWorkflow();

    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${revokedKey.rawKey}`)
      .send({ idempotencyKey: 'revoked-key' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });

  // ── Authorization ──

  it('rejects an API key without WORKFLOW_EXECUTE permission', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${readOnlyApiKey}`)
      .send({ idempotencyKey: 'no-permission' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks VIEWER-scoped API key from triggering', async () => {
    const viewerKey = await createAPIKey(workspaceId, userId, 'Viewer Key', ['WORKFLOW_READ']);
    const workflowId = await createPublishedWorkflow();

    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${viewerKey.rawKey}`)
      .send({ idempotencyKey: 'viewer-denied' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks cross-workspace workflow access', async () => {
    const otherWorkspaceId = new Types.ObjectId().toString();
    const otherUserId = new Types.ObjectId().toString();
    const workflowId = await createPublishedWorkflow({
      workspaceId: otherWorkspaceId,
      ownerId: otherUserId,
    });

    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'cross-workspace' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // ── Request Validation ──

  it('rejects a missing idempotency key', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects unknown fields in the request body', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'unknown-fields', unexpected: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects an invalid workflow ID', async () => {
    const res = await request
      .post('/api/v1/workflows/not-an-id/trigger')
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'invalid-id' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WORKFLOW_ID');
  });

  it('rejects a workflow that does not exist', async () => {
    const fakeId = new Types.ObjectId().toString();
    const res = await request
      .post(`/api/v1/workflows/${fakeId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'not-found' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('rejects a workflow without a published version', async () => {
    const workflow = await WorkflowModel.create({
      name: 'Draft Only',
      draftDefinition: validDefinition(),
      status: 'DRAFT',
      latestVersionNumber: 0,
      ownerId: new Types.ObjectId(userId),
      workspaceId: new Types.ObjectId(workspaceId),
    });
    const res = await request
      .post(`/api/v1/workflows/${workflow._id.toString()}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'no-publish' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_PUBLISHED_VERSION');
  });

  // ── Execution lifecycle ──

  it('creates execution with QUEUING → QUEUED lifecycle', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'lifecycle-1', input: { step: 1 } });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.statusHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'QUEUING' }),
        expect.objectContaining({ status: 'QUEUED' }),
      ]),
    );

    const execution = await WorkflowExecutionModel.findById(res.body.executionId);
    expect(execution).toBeTruthy();
    expect(execution!.workspaceId?.toString()).toBe(workspaceId);
    expect(execution!.workflowId.toString()).toBe(workflowId);
  });

  it('enqueues execution job to the worker queue', async () => {
    const workflowId = await createPublishedWorkflow();
    await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'worker-1', input: {} });

    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.data.executionId).toBeTruthy();
  });

  // ── Idempotency ──

  it('replays the same idempotency key without a second job', async () => {
    const workflowId = await createPublishedWorkflow();
    const first = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'idem-1', input: { a: 1 } });
    const second = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'idem-1', input: { a: 1 } });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.executionId).toBe(first.body.executionId);
    expect(second.body.replayed).toBe(true);
    expect(queue.jobs).toHaveLength(1);
  });

  it('rejects idempotency key reuse with different input', async () => {
    const workflowId = await createPublishedWorkflow();
    await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'conflict-1', input: { a: 1 } });
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'conflict-1', input: { a: 2 } });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  // ── Audit ──

  it('writes an audit log on successful trigger', async () => {
    const workflowId = await createPublishedWorkflow();
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'audit-1', input: { foo: 'bar' } });

    const auditLog = await AuditLogModel.findOne({ action: 'EXTERNAL_WORKFLOW_TRIGGERED' });
    expect(auditLog).toBeTruthy();
    expect(auditLog?.resource).toBe('execution');
    expect(auditLog?.workspaceId?.toString()).toBe(workspaceId);
    expect(auditLog?.metadata?.workflowId).toBe(workflowId);
    expect(auditLog?.metadata?.executionId).toBe(res.body.executionId);
    expect(auditLog?.metadata?.apiKeyId).toBeTruthy();
  });

  // ── Error handling ──

  it('returns 503 when the queue is unavailable', async () => {
    const workflowId = await createPublishedWorkflow();
    queue.shouldFail = true;
    const res = await request
      .post(`/api/v1/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${executeApiKey}`)
      .send({ idempotencyKey: 'queue-fail' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('QUEUE_UNAVAILABLE');
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import type { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/api/app.js';
import type {
  ExecutionEnqueueOptions,
  ExecutionJobData,
  ExecutionQueue,
} from '../src/queues/executionQueue.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { DeadLetterModel } from '../src/models/DeadLetterModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import {
  EXECUTION_TIMEOUT_CODE,
  createWorkflowExecution,
  runExecutionAttempt,
} from '../src/services/executionService.js';
import type { ExecutionResult, WorkflowDefinition } from '../src/types/workflow.js';
import type { CreateExecutionRequest } from '../src/schemas/executionSchema.js';
import { ensureUserWorkspace } from '../src/services/workspaceService.js';

interface RecordedJob {
  data: ExecutionJobData;
  options: ExecutionEnqueueOptions;
}

class RecordingQueue implements ExecutionQueue {
  jobs: RecordedJob[] = [];

  async enqueue(data: ExecutionJobData, options: ExecutionEnqueueOptions): Promise<void> {
    this.jobs.push({ data, options });
  }

  async close(): Promise<void> {}
}

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};
let accessToken: string;
let ownerId: string;
let workspaceId: string;
let editorId: string;
let editorToken: string;
let viewerId: string;
let viewerToken: string;
let outsiderToken: string;

function withDefaultAuth(app: Express) {
  const outer = express();
  outer.use((req, _res, next) => {
    if (!req.headers.authorization) req.headers.authorization = 'Bearer ' + accessToken;
    next();
  });
  outer.use(app);
  return outer;
}

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
const queue = new RecordingQueue();

function validDefinition(message = 'phase-2e') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  } satisfies WorkflowDefinition;
}

async function createPublishedWorkflow(message = 'phase-2e', sharedWorkspaceId?: string): Promise<string> {
  const workflow = await WorkflowModel.create({
    name: 'Hardened workflow',
    draftDefinition: validDefinition(message),
    status: 'DRAFT',
    latestVersionNumber: 0,
    ownerId: new Types.ObjectId(ownerId),
    ...(sharedWorkspaceId ? { workspaceId: new Types.ObjectId(sharedWorkspaceId) } : {}),
  });
  const version = await WorkflowVersionModel.create({
    workflowId: workflow._id,
    versionNumber: 1,
    definition: validDefinition(message),
  });
  workflow.status = 'PUBLISHED';
  workflow.latestVersionNumber = 1;
  workflow.publishedVersionId = version._id;
  await workflow.save();
  return workflow._id.toString();
}

async function queueExecution(
  workflowId: string,
  idempotencyKey = 'hardening-1',
  overrides: Partial<CreateExecutionRequest> = {},
) {
  return createWorkflowExecution(
    queue,
    workflowId,
    { idempotencyKey, input: { estimatedCost: 15_000 }, ...overrides },
    ownerId,
    workspaceId,
    { attempts: 3, backoffMs: 10 },
  );
}

function neverResolves(): Promise<ExecutionResult> {
  return new Promise<ExecutionResult>(() => {});
}

beforeAll(async () => {
  const platformArgs = process.platform === 'win32' || process.env.MONGOMS_SYSTEM_BINARY
    ? []
    : ['--nounixsocket'];
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, args: platformArgs },
  });
  await mongoose.connect(replSet.getUri());
  const user = await UserModel.create({
    email: 'execution-hardening-tests@example.com',
    passwordHash: await hashPassword('test-password-123'),
  });
  ownerId = user._id.toString();
  workspaceId = await ensureUserWorkspace(ownerId);
  accessToken = signAccessToken(authConfig, { userId: ownerId, email: user.email });
  const editor = await UserModel.create({
    email: 'execution-hardening-editor@example.com',
    passwordHash: await hashPassword('test-password-123'),
  });
  editorId = editor._id.toString();
  editorToken = signAccessToken(authConfig, { userId: editorId, email: editor.email });
  const viewer = await UserModel.create({
    email: 'execution-hardening-viewer@example.com',
    passwordHash: await hashPassword('test-password-123'),
  });
  viewerId = viewer._id.toString();
  viewerToken = signAccessToken(authConfig, { userId: viewerId, email: viewer.email });
  const outsider = await UserModel.create({
    email: 'execution-hardening-outsider@example.com',
    passwordHash: await hashPassword('test-password-123'),
  });
  outsiderToken = signAccessToken(authConfig, { userId: outsider._id.toString(), email: outsider.email });
  request = supertest(withDefaultAuth(createApp({
    executionQueue: queue,
    executionCreationOptions: { attempts: 3, backoffMs: 10 },
    auth: authConfig,
  })));
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30_000);

beforeEach(async () => {
  queue.jobs = [];
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await DeadLetterModel.deleteMany({});
  await AuditLogModel.deleteMany({});
});

describe('Phase 2E execution hardening', () => {
  it('queues a fixed retry policy with matching job options', async () => {
    const workflowId = await createPublishedWorkflow();
    const response = await request
      .post('/api/workflows/' + workflowId + '/executions')
      .send({ idempotencyKey: 'policy-1', retryPolicy: { type: 'FIXED', delayMs: 250, maxRetries: 1 } });

    expect(response.status).toBe(202);
    expect(response.body.retryPolicy).toEqual({ type: 'FIXED', delayMs: 250 });
    expect(response.body.maxRetries).toBe(1);
    expect(response.body.retryCount).toBe(0);
    expect(queue.jobs[0]?.options).toMatchObject({ attempts: 2, backoffMs: 250, backoffType: 'fixed' });
  });

  it('caps a requested retry budget at the server attempt budget', async () => {
    const workflowId = await createPublishedWorkflow();
    const response = await request
      .post('/api/workflows/' + workflowId + '/executions')
      .send({
        idempotencyKey: 'policy-capped',
        retryPolicy: { type: 'EXPONENTIAL', delayMs: 100, backoffFactor: 3, maxRetries: 19 },
      });

    expect(response.status).toBe(202);
    expect(response.body.maxRetries).toBe(2);
    expect(response.body.retryPolicy).toEqual({ type: 'EXPONENTIAL', delayMs: 100, backoffFactor: 3 });
    expect(queue.jobs[0]?.options).toMatchObject({ attempts: 3, backoffType: 'exponential' });
  });

  it('rejects invalid retry policies and timeouts', async () => {
    const workflowId = await createPublishedWorkflow();
    const invalidPolicy = await request
      .post('/api/workflows/' + workflowId + '/executions')
      .send({ idempotencyKey: 'bad-policy', retryPolicy: { type: 'LINEAR', delayMs: 100 } });
    const invalidTimeout = await request
      .post('/api/workflows/' + workflowId + '/executions')
      .send({ idempotencyKey: 'bad-timeout', timeoutMs: -1 });

    expect(invalidPolicy.status).toBe(400);
    expect(invalidPolicy.body.error.code).toBe('INVALID_REQUEST');
    expect(invalidTimeout.status).toBe(400);
    expect(invalidTimeout.body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns a timed-out attempt to QUEUED with a scheduled retry', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await request
      .post('/api/workflows/' + workflowId + '/executions')
      .send({ idempotencyKey: 'timeout-retry', timeoutMs: 30 });
    expect(created.status).toBe(202);
    expect(created.body.timeoutMs).toBe(30);

    await expect(runExecutionAttempt(created.body.executionId, 1, 2, neverResolves))
      .rejects.toThrow(EXECUTION_TIMEOUT_CODE);

    const queued = await WorkflowExecutionModel.findById(created.body.executionId);
    expect(queued?.status).toBe('QUEUED');
    expect(queued?.attemptsMade).toBe(1);
    expect(queued?.retryCount).toBe(1);
    expect(queued?.nextRetryAt).toBeInstanceOf(Date);

    const view = await request.get('/api/executions/' + created.body.executionId);
    expect(view.body.retryCount).toBe(1);
    expect(typeof view.body.nextRetryAt).toBe('string');
  });

  it('fails terminally with a dead letter when the final attempt times out', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId, 'timeout-terminal', { timeoutMs: 20 });

    await expect(runExecutionAttempt(created.execution._id.toString(), 1, 1, neverResolves))
      .rejects.toThrow(EXECUTION_TIMEOUT_CODE);

    const failed = await WorkflowExecutionModel.findById(created.execution._id);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error?.code).toBe(EXECUTION_TIMEOUT_CODE);

    const deadLetter = await DeadLetterModel.findOne({ executionId: created.execution._id });
    expect(deadLetter?.failureReason).toBe(EXECUTION_TIMEOUT_CODE);
    expect(deadLetter?.attempts).toBe(1);
  });

  it('records one dead letter per terminally failed execution', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId, 'dead-letter-1');
    const failing = async (): Promise<ExecutionResult> => {
      throw new Error('private upstream details');
    };

    await expect(runExecutionAttempt(created.execution._id.toString(), 1, 2, failing))
      .rejects.toThrow('private upstream details');
    await expect(runExecutionAttempt(created.execution._id.toString(), 2, 2, failing))
      .rejects.toThrow('private upstream details');

    const deadLetters = await DeadLetterModel.find({ executionId: created.execution._id });
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.failureReason).toBe('EXECUTION_FAILED');
    expect(deadLetters[0]?.attempts).toBe(2);
    expect(deadLetters[0]?.message).not.toContain('private upstream details');

    const listing = await request.get('/api/workflows/' + workflowId + '/dead-letters');
    expect(listing.status).toBe(200);
    expect(listing.body).toHaveLength(1);
    expect(listing.body[0]).toMatchObject({
      executionId: created.execution._id.toString(),
      failureReason: 'EXECUTION_FAILED',
      attempts: 2,
    });
  });

  it('lists dead letters newest first and hides unknown workflows', async () => {
    const workflowId = await createPublishedWorkflow();
    await DeadLetterModel.create({
      executionId: new Types.ObjectId(),
      workflowId,
      failureReason: 'EXECUTION_FAILED',
      attempts: 1,
      failedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await DeadLetterModel.create({
      executionId: new Types.ObjectId(),
      workflowId,
      failureReason: 'EXECUTION_TIMEOUT',
      attempts: 2,
      failedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const listing = await request.get('/api/workflows/' + workflowId + '/dead-letters');
    expect(listing.status).toBe(200);
    expect(listing.body.map((entry: { failureReason: string }) => entry.failureReason))
      .toEqual(['EXECUTION_TIMEOUT', 'EXECUTION_FAILED']);

    const invalid = await request.get('/api/workflows/not-an-id/dead-letters');
    const missing = await request.get('/api/workflows/507f1f77bcf86cd799439011/dead-letters');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_WORKFLOW_ID');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('replays a failed execution as a new linked execution', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId, 'replay-source');
    const failing = async (): Promise<ExecutionResult> => {
      throw new Error('broken dependency');
    };
    await expect(runExecutionAttempt(created.execution._id.toString(), 1, 1, failing))
      .rejects.toThrow('broken dependency');

    const response = await request.post('/api/executions/' + created.execution._id.toString() + '/replay');
    expect(response.status).toBe(202);
    expect(response.body.parentExecutionId).toBe(created.execution._id.toString());
    expect(response.body.executionId).not.toBe(created.execution._id.toString());
    expect(response.body.status).toBe('QUEUED');
    expect(response.body.idempotencyKey).not.toBe(created.execution.idempotencyKey);
    expect(response.body.maxRetries).toBe(2);
    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs[1]?.data.executionId).toBe(response.body.executionId);

    const original = await WorkflowExecutionModel.findById(created.execution._id);
    expect(original?.status).toBe('FAILED');

    const audit = await AuditLogModel.findOne({ action: 'EXECUTION_REPLAYED' });
    expect(audit?.resourceId).toBe(response.body.executionId);
  });

  it('replays a succeeded execution without touching the original', async () => {
    const workflowId = await createPublishedWorkflow('replay output');
    const created = await queueExecution(workflowId, 'replay-success');
    const completed = await runExecutionAttempt(created.execution._id.toString(), 1, 3);
    expect(completed.status).toBe('SUCCEEDED');

    const response = await request.post('/api/executions/' + created.execution._id.toString() + '/replay');
    expect(response.status).toBe(202);
    expect(response.body.parentExecutionId).toBe(created.execution._id.toString());
    expect(queue.jobs).toHaveLength(2);
  });

  it('rejects replaying an execution that has not finished', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId, 'replay-open');

    const response = await request.post('/api/executions/' + created.execution._id.toString() + '/replay');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EXECUTION_NOT_REPLAYABLE');
  });

  it('returns safe errors when replay targets invalid or missing executions', async () => {
    const invalid = await request.post('/api/executions/not-an-id/replay');
    const missing = await request.post('/api/executions/507f1f77bcf86cd799439011/replay');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_EXECUTION_ID');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('EXECUTION_NOT_FOUND');
  });

  it('enforces permissions on replay and dead-letter routes', async () => {
    const workspace = await WorkspaceModel.create({
      name: 'Reliability workspace',
      slug: 'reliability-' + new Types.ObjectId().toString(),
      ownerId: new Types.ObjectId(ownerId),
      status: 'ACTIVE',
    });
    const sharedWorkspaceId = workspace._id.toString();
    await WorkspaceMemberModel.insertMany([
      { workspaceId: workspace._id, userId: new Types.ObjectId(ownerId), role: 'OWNER', status: 'ACTIVE', permissions: permissionsForRole('OWNER') },
      { workspaceId: workspace._id, userId: new Types.ObjectId(editorId), role: 'EDITOR', status: 'ACTIVE', permissions: permissionsForRole('EDITOR') },
      { workspaceId: workspace._id, userId: new Types.ObjectId(viewerId), role: 'VIEWER', status: 'ACTIVE', permissions: permissionsForRole('VIEWER') },
    ]);

    const workflowId = await createPublishedWorkflow('shared workspace', sharedWorkspaceId);
    const created = await createWorkflowExecution(
      queue,
      workflowId,
      { idempotencyKey: 'shared-replay', input: {} },
      ownerId,
      sharedWorkspaceId,
      { attempts: 3, backoffMs: 10 },
    );
    const executionId = created.execution._id.toString();
    const failing = async (): Promise<ExecutionResult> => {
      throw new Error('downstream failure');
    };
    await expect(runExecutionAttempt(executionId, 1, 1, failing)).rejects.toThrow('downstream failure');

    const viewerList = await request
      .get('/api/workflows/' + workflowId + '/dead-letters')
      .set('Authorization', 'Bearer ' + viewerToken);
    expect(viewerList.status).toBe(200);
    expect(viewerList.body).toHaveLength(1);

    const viewerReplay = await request
      .post('/api/executions/' + executionId + '/replay')
      .set('Authorization', 'Bearer ' + viewerToken);
    expect(viewerReplay.status).toBe(403);
    expect(viewerReplay.body.error.code).toBe('FORBIDDEN');

    const editorReplay = await request
      .post('/api/executions/' + executionId + '/replay')
      .set('Authorization', 'Bearer ' + editorToken);
    expect(editorReplay.status).toBe(202);
    expect(editorReplay.body.parentExecutionId).toBe(executionId);

    const outsiderList = await request
      .get('/api/workflows/' + workflowId + '/dead-letters')
      .set('Authorization', 'Bearer ' + outsiderToken);
    expect(outsiderList.status).toBe(404);
    expect(outsiderList.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const outsiderReplay = await request
      .post('/api/executions/' + executionId + '/replay')
      .set('Authorization', 'Bearer ' + outsiderToken);
    expect(outsiderReplay.status).toBe(404);
    expect(outsiderReplay.body.error.code).toBe('EXECUTION_NOT_FOUND');

    const anonymousReplay = await supertest(createApp({ executionQueue: queue, auth: authConfig }))
      .post('/api/executions/' + executionId + '/replay');
    expect(anonymousReplay.status).toBe(401);
    expect(anonymousReplay.body.error.code).toBe('UNAUTHENTICATED');
  });
});

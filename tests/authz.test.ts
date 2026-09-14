import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import type {
  ExecutionEnqueueOptions,
  ExecutionJobData,
  ExecutionQueue,
} from '../src/queues/executionQueue.js';

class RecordingQueue implements ExecutionQueue {
  jobs: Array<{ data: ExecutionJobData; options: ExecutionEnqueueOptions }> = [];

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

const queue = new RecordingQueue();

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

function validDefinition(message = 'ready') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({ executionQueue: queue, auth: authConfig }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  queue.jobs = [];
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
});

async function createSession(email: string) {
  await request.post('/api/auth/register').send({ email, password: 'correct-horse-1' });
  const login = await request.post('/api/auth/login').send({ email, password: 'correct-horse-1' });
  expect(login.status).toBe(200);
  return { token: login.body.accessToken as string };
}

function withToken(token: string) {
  return (test: supertest.Test) => test.set('Authorization', `Bearer ${token}`);
}

describe('Phase 2D authorization isolation', () => {
  it('rejects protected workflow and execution routes without a token', async () => {
    const workflow = await request.get('/api/workflows/507f1f77bcf86cd799439011');
    expect(workflow.status).toBe(401);
    expect(workflow.body.error.code).toBe('UNAUTHENTICATED');

    const execution = await request.get('/api/executions/507f1f77bcf86cd799439011');
    expect(execution.status).toBe(401);
    expect(execution.body.error.code).toBe('UNAUTHENTICATED');

    const queueAttempt = await request
      .post('/api/workflows/507f1f77bcf86cd799439011/executions')
      .send({ idempotencyKey: 'booking-1' });
    expect(queueAttempt.status).toBe(401);
    expect(queue.jobs).toHaveLength(0);
  });

  it('returns 404 for every workflow endpoint of another user', async () => {
    const owner = await createSession('owner@example.com');
    const other = await createSession('other@example.com');

    const created = await withToken(owner.token)(request.post('/api/workflows')).send({
      name: 'Owned workflow',
      definition: validDefinition(),
    });
    expect(created.status).toBe(201);
    const workflowId = created.body._id as string;

    const get = await withToken(other.token)(request.get(`/api/workflows/${workflowId}`));
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const update = await withToken(other.token)(request.put(`/api/workflows/${workflowId}/draft`))
      .send({ name: 'Hijacked' });
    expect(update.status).toBe(404);
    expect(update.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const validate = await withToken(other.token)(request.post(`/api/workflows/${workflowId}/validate`));
    expect(validate.status).toBe(404);

    const publish = await withToken(other.token)(request.post(`/api/workflows/${workflowId}/publish`));
    expect(publish.status).toBe(404);

    const versions = await withToken(other.token)(request.get(`/api/workflows/${workflowId}/versions`));
    expect(versions.status).toBe(404);

    const ownerView = await withToken(owner.token)(request.get(`/api/workflows/${workflowId}`));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.name).toBe('Owned workflow');
  });

  it('isolates executions between users', async () => {
    const owner = await createSession('owner@example.com');
    const other = await createSession('other@example.com');

    const created = await withToken(owner.token)(request.post('/api/workflows')).send({
      name: 'Executable workflow',
      definition: validDefinition(),
    });
    const workflowId = created.body._id as string;

    const published = await withToken(owner.token)(request.post(`/api/workflows/${workflowId}/publish`));
    expect(published.status).toBe(201);

    const queued = await withToken(owner.token)(request.post(`/api/workflows/${workflowId}/executions`))
      .send({ idempotencyKey: 'booking-1', input: { estimatedCost: 15_000 } });
    expect(queued.status).toBe(202);
    const executionId = queued.body.executionId as string;
    expect(queue.jobs).toHaveLength(1);

    const otherCreate = await withToken(other.token)(request.post(`/api/workflows/${workflowId}/executions`))
      .send({ idempotencyKey: 'booking-2' });
    expect(otherCreate.status).toBe(404);
    expect(otherCreate.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const otherGet = await withToken(other.token)(request.get(`/api/executions/${executionId}`));
    expect(otherGet.status).toBe(404);
    expect(otherGet.body.error.code).toBe('EXECUTION_NOT_FOUND');

    const otherList = await withToken(other.token)(request.get(`/api/workflows/${workflowId}/executions`));
    expect(otherList.status).toBe(404);
    expect(otherList.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const ownerGet = await withToken(owner.token)(request.get(`/api/executions/${executionId}`));
    expect(ownerGet.status).toBe(200);
    expect(ownerGet.body.executionId).toBe(executionId);
    expect(queue.jobs).toHaveLength(1);
  });

  it('rejects ownerId spoofing attempts in request bodies', async () => {
    const owner = await createSession('owner@example.com');
    const spoof = await withToken(owner.token)(request.post('/api/workflows')).send({
      name: 'Spoof attempt',
      definition: validDefinition(),
      ownerId: new mongoose.Types.ObjectId().toString(),
    });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error.code).toBe('INVALID_REQUEST');
  });
});
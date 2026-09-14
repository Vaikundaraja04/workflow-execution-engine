import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { createAuditLog } from '../src/services/auditService.js';
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

function validDefinition() {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message: 'audit' } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({
    executionQueue: queue,
    auth: authConfig,
    authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  queue.jobs = [];
  await AuditLogModel.deleteMany({});
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
});

async function registerAndLogin(email: string) {
  const register = await request
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-1' })
    .set('User-Agent', 'audit-test-agent');
  expect(register.status).toBe(201);
  const login = await request
    .post('/api/auth/login')
    .send({ email, password: 'correct-horse-1' })
    .set('User-Agent', 'audit-test-agent');
  expect(login.status).toBe(200);
  return {
    userId: register.body.id as string,
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  };
}

describe('Phase 2E audit logging', () => {
  it('logs registrations and successful logins', async () => {
    const session = await registerAndLogin('audit-user@example.com');

    const registered = await AuditLogModel.findOne({ action: 'AUTH_REGISTERED' });
    expect(registered?.userId?.toString()).toBe(session.userId);
    expect(registered?.userAgent).toBe('audit-test-agent');
    expect(registered?.ipAddress).toBeTruthy();

    const loggedIn = await AuditLogModel.findOne({ action: 'AUTH_LOGIN_SUCCESS' });
    expect(loggedIn?.userId?.toString()).toBe(session.userId);
    expect(loggedIn?.userAgent).toBe('audit-test-agent');
  });

  it('logs failed logins', async () => {
    await registerAndLogin('audit-user@example.com');

    const wrongPassword = await request
      .post('/api/auth/login')
      .send({ email: 'audit-user@example.com', password: 'wrong-password-1' });
    expect(wrongPassword.status).toBe(401);

    const unknownEmail = await request
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'correct-horse-1' });
    expect(unknownEmail.status).toBe(401);

    const failed = await AuditLogModel.find({ action: 'AUTH_LOGIN_FAILED' });
    expect(failed).toHaveLength(2);
    expect(failed[0]?.ipAddress).toBeTruthy();
  });

  it('logs refresh rotation and replay detection', async () => {
    const session = await registerAndLogin('audit-user@example.com');

    const rotated = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);

    const replay = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);

    expect(await AuditLogModel.countDocuments({ action: 'AUTH_REFRESH' })).toBe(1);
    const replayLog = await AuditLogModel.findOne({ action: 'AUTH_REFRESH_REPLAY' });
    expect(replayLog?.userId?.toString()).toBe(session.userId);
  });

  it('logs workflow and execution events', async () => {
    const session = await registerAndLogin('audit-user@example.com');
    const authorization = `Bearer ${session.accessToken}`;

    const created = await request
      .post('/api/workflows')
      .set('Authorization', authorization)
      .send({ name: 'Audited workflow', definition: validDefinition() });
    expect(created.status).toBe(201);

    const updated = await request
      .put(`/api/workflows/${created.body._id}/draft`)
      .set('Authorization', authorization)
      .send({ name: 'Audited workflow v2' });
    expect(updated.status).toBe(200);

    const published = await request
      .post(`/api/workflows/${created.body._id}/publish`)
      .set('Authorization', authorization);
    expect(published.status).toBe(201);

    const queued = await request
      .post(`/api/workflows/${created.body._id}/executions`)
      .set('Authorization', authorization)
      .send({ idempotencyKey: 'audit-1' });
    expect(queued.status).toBe(202);

    const workflowCreated = await AuditLogModel.findOne({ action: 'WORKFLOW_CREATED' });
    expect(workflowCreated?.resource).toBe('workflow');
    expect(workflowCreated?.resourceId).toBe(created.body._id);
    expect(workflowCreated?.userId?.toString()).toBe(session.userId);

    expect(await AuditLogModel.countDocuments({ action: 'WORKFLOW_UPDATED' })).toBe(1);

    const executionStarted = await AuditLogModel.findOne({ action: 'EXECUTION_STARTED' });
    expect(executionStarted?.resource).toBe('execution');
    expect(executionStarted?.resourceId).toBe(queued.body.executionId);
    expect(executionStarted?.metadata).toMatchObject({ workflowId: created.body._id });
  });

  it('stores no passwords or raw tokens', async () => {
    const session = await registerAndLogin('audit-user@example.com');
    await request.post('/api/auth/refresh').send({ refreshToken: session.refreshToken });

    const stored = JSON.stringify(await AuditLogModel.find({}));
    expect(stored).not.toContain('correct-horse-1');
    expect(stored).not.toContain('passwordHash');
    expect(stored).not.toContain(session.refreshToken);

    await createAuditLog({
      action: 'AUTH_LOGIN_FAILED',
      metadata: { password: 'hidden', refreshToken: 'hidden', userAgent: 'kept' },
    });
    const sanitized = await AuditLogModel.findOne({ action: 'AUTH_LOGIN_FAILED' });
    expect(sanitized?.metadata).toEqual({ userAgent: 'kept' });
  });
});
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Request, Response } from 'express';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { ensureUserWorkspace } from '../src/services/workspaceService.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

interface CapturedLog {
  [key: string]: unknown;
  level?: string;
  message?: string;
}

const logRecords: CapturedLog[] = [];
const rawLines: string[] = [];
let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let ownerId: string;
let accessToken: string;
let workflowId: string;
let versionId: string;

function capture(raw: unknown): void {
  if (typeof raw !== 'string') return;
  rawLines.push(raw);
  try {
    logRecords.push(JSON.parse(raw) as CapturedLog);
  } catch {
    // Non-JSON console output is not part of the structured log stream.
  }
}

function findRequestLog(path: string, status?: number): CapturedLog | undefined {
  return [...logRecords].reverse().find(record => record.message === 'http_request'
    && record.path === path
    && (status === undefined || record.status === status));
}

function validDefinition(): WorkflowDefinition {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message: 'observability' } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  };
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  const platformArgs = process.platform === 'win32' || process.env.MONGOMS_SYSTEM_BINARY
    ? []
    : ['--nounixsocket'];
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, args: platformArgs } });
  await mongoose.connect(replSet.getUri());
  const user = await UserModel.create({ email: 'observability@example.com', passwordHash: 'not-used' });
  ownerId = user._id.toString();
  await ensureUserWorkspace(ownerId);
  accessToken = signAccessToken(authConfig, { userId: ownerId, email: user.email });
  request = supertest(createApp({ auth: authConfig }));
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30_000);

beforeEach(async () => {
  logRecords.length = 0;
  rawLines.length = 0;
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await AuditLogModel.deleteMany({});

  const workflow = await WorkflowModel.create({
    name: 'Observed workflow',
    draftDefinition: validDefinition(),
    status: 'DRAFT',
    latestVersionNumber: 0,
    ownerId: new Types.ObjectId(ownerId),
  });
  const version = await WorkflowVersionModel.create({
    workflowId: workflow._id,
    versionNumber: 1,
    definition: validDefinition(),
  });
  workflow.status = 'PUBLISHED';
  workflow.latestVersionNumber = 1;
  workflow.publishedVersionId = version._id;
  await workflow.save();
  workflowId = workflow._id.toString();
  versionId = version._id.toString();
});

describe('Phase 4 structured observability', () => {
  it('emits a structured request log with the client supplied request id', async () => {
    const response = await request.get('/health/live').set('x-request-id', 'request-log-test-1');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('request-log-test-1');

    const entry = findRequestLog('/health/live');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      level: 'info',
      message: 'http_request',
      service: 'workflow-execution-engine',
      method: 'GET',
      path: '/health/live',
      status: 200,
      requestId: 'request-log-test-1',
    });
    expect(typeof entry?.durationMs).toBe('number');
    expect(typeof entry?.timestamp).toBe('string');
  });

  it('generates a request id when the client does not send one', async () => {
    const response = await request.get('/health/live');
    const requestId = response.headers['x-request-id'];

    expect(typeof requestId).toBe('string');
    expect(String(requestId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(findRequestLog('/health/live')?.requestId).toBe(requestId);
  });

  it('correlates authenticated requests with user, workspace, workflow, and execution ids', async () => {
    const execution = await WorkflowExecutionModel.create({
      workflowId: new Types.ObjectId(workflowId),
      ownerId: new Types.ObjectId(ownerId),
      workflowVersionId: new Types.ObjectId(versionId),
      versionNumber: 1,
      jobId: 'execution-observability-1',
      idempotencyKey: 'observability-1',
      inputHash: 'hash',
      input: {},
      status: 'QUEUED',
      attemptsMade: 0,
      statusHistory: [],
    });

    const workflowResponse = await request
      .get('/api/workflows/' + workflowId)
      .set('Authorization', 'Bearer ' + accessToken);
    expect(workflowResponse.status).toBe(200);

    const workflowLog = findRequestLog('/api/workflows/' + workflowId, 200);
    expect(workflowLog).toMatchObject({ userId: ownerId, workflowId });
    expect(typeof workflowLog?.workspaceId).toBe('string');

    const executionResponse = await request
      .get('/api/executions/' + execution._id.toString())
      .set('Authorization', 'Bearer ' + accessToken);
    expect(executionResponse.status).toBe(200);

    const executionLog = findRequestLog('/api/executions/' + execution._id.toString(), 200);
    expect(executionLog).toMatchObject({ userId: ownerId, executionId: execution._id.toString() });
    expect(typeof executionLog?.workspaceId).toBe('string');
  });
});

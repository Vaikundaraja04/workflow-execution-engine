import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/api/app.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import type { WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { WorkflowAnalyticsModel } from '../src/models/WorkflowAnalyticsModel.js';
import { ExecutionAnalyticsModel } from '../src/models/ExecutionAnalyticsModel.js';
import { WorkspaceUsageModel } from '../src/models/WorkspaceUsageModel.js';
import {
  recordExecutionOutcome,
  recalculateAnalytics,
} from '../src/services/analyticsService.js';
import { runExecutionAttempt } from '../src/services/executionService.js';
import type {
  ExecutionEnqueueOptions,
  ExecutionJobData,
  ExecutionQueue,
} from '../src/queues/executionQueue.js';
import type { ExecutionResult, WorkflowDefinition } from '../src/types/workflow.js';

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

interface Session {
  id: string;
  token: string;
}

let owner: Session;
let editor: Session;
let viewer: Session;
let outsider: Session;
let workspaceId: string;

function authHeader(token: string) {
  return { Authorization: 'Bearer ' + token };
}

function validDefinition(message = 'analytics') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  } satisfies WorkflowDefinition;
}

async function createUser(email: string): Promise<Session> {
  const user = await UserModel.create({ email, passwordHash: 'not-used' });
  const id = user._id.toString();
  return { id, token: signAccessToken(authConfig, { userId: id, email }) };
}

async function addMember(userId: string, role: WorkspaceRole): Promise<void> {
  await WorkspaceMemberModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    role,
    status: 'ACTIVE',
    permissions: permissionsForRole(role),
  });
}

async function createWorkflow(name: string): Promise<string> {
  const created = await request
    .post('/api/workflows')
    .set(authHeader(owner.token))
    .send({ name, definition: validDefinition(name), workspaceId });
  expect(created.status).toBe(201);
  const workflowId = created.body._id as string;
  const published = await request
    .post('/api/workflows/' + workflowId + '/publish')
    .set(authHeader(owner.token));
  expect(published.status).toBe(201);
  return workflowId;
}

async function queueExecution(workflowId: string, idempotencyKey: string): Promise<string> {
  const queued = await request
    .post('/api/workflows/' + workflowId + '/executions')
    .set(authHeader(owner.token))
    .send({ idempotencyKey, input: { source: 'analytics-test' } });
  expect(queued.status).toBe(202);
  return queued.body.executionId as string;
}

function failingExecutor(): () => Promise<ExecutionResult> {
  return async () => {
    throw new Error('downstream failure');
  };
}

beforeAll(async () => {
  const platformArgs = process.platform === 'win32' || process.env.MONGOMS_SYSTEM_BINARY
    ? []
    : ['--nounixsocket'];
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, args: platformArgs } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({ executionQueue: queue, auth: authConfig }));
  owner = await createUser('analytics-owner@example.com');
  editor = await createUser('analytics-editor@example.com');
  viewer = await createUser('analytics-viewer@example.com');
  outsider = await createUser('analytics-outsider@example.com');
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30_000);

beforeEach(async () => {
  queue.jobs = [];
  await WorkflowAnalyticsModel.deleteMany({});
  await ExecutionAnalyticsModel.deleteMany({});
  await WorkspaceUsageModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});

  const workspace = await WorkspaceModel.create({
    name: 'Analytics workspace',
    slug: 'analytics-' + new Types.ObjectId().toString(),
    ownerId: new Types.ObjectId(owner.id),
    status: 'ACTIVE',
  });
  workspaceId = workspace._id.toString();
  await addMember(owner.id, 'OWNER');
  await addMember(editor.id, 'EDITOR');
  await addMember(viewer.id, 'VIEWER');
});

describe('Phase 3E analytics platform', () => {
  it('tracks workflow metrics for successful and failed executions', async () => {
    const workflowId = await createWorkflow('Metrics workflow');
    const first = await queueExecution(workflowId, 'metrics-1');
    const second = await queueExecution(workflowId, 'metrics-2');

    const succeeded = await runExecutionAttempt(first, 1, 3);
    expect(succeeded.status).toBe('SUCCEEDED');
    await expect(runExecutionAttempt(second, 1, 1, failingExecutor()))
      .rejects.toThrow('downstream failure');

    const response = await request
      .get('/api/analytics/workflows/' + workflowId)
      .set(authHeader(owner.token));

    expect(response.status).toBe(200);
    expect(response.body.workflowId).toBe(workflowId);
    expect(response.body.totalExecutions).toBe(2);
    expect(response.body.successfulExecutions).toBe(1);
    expect(response.body.failedExecutions).toBe(1);
    expect(response.body.successRate).toBe(0.5);
    expect(response.body.failureRate).toBe(0.5);
    expect(response.body.replayCount).toBe(0);
    expect(typeof response.body.averageDurationMs).toBe('number');
    expect(typeof response.body.lastExecutedAt).toBe('string');

    const rows = await ExecutionAnalyticsModel.find({ workflowId });
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.status).sort()).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('tracks execution metrics with retries and node timings', async () => {
    const workflowId = await createWorkflow('Retry workflow');
    const executionId = await queueExecution(workflowId, 'retry-1');

    let calls = 0;
    const flakyExecutor = async (): Promise<ExecutionResult> => {
      calls += 1;
      if (calls === 1) throw new Error('transient failure');
      return {
        status: 'SUCCEEDED',
        stepStatuses: { trigger: 'SUCCEEDED', log: 'SUCCEEDED' },
        outputs: { log: { message: 'retried' } },
        executionHistory: [
          { nodeId: 'trigger', fromStatus: 'READY', toStatus: 'RUNNING', timestamp: '2026-09-15T08:00:00.000Z' },
          { nodeId: 'trigger', fromStatus: 'RUNNING', toStatus: 'SUCCEEDED', timestamp: '2026-09-15T08:00:01.000Z' },
          { nodeId: 'log', fromStatus: 'READY', toStatus: 'RUNNING', timestamp: '2026-09-15T08:00:02.000Z' },
          { nodeId: 'log', fromStatus: 'RUNNING', toStatus: 'SUCCEEDED', timestamp: '2026-09-15T08:00:03.000Z' },
        ],
      };
    };

    await expect(runExecutionAttempt(executionId, 1, 3, flakyExecutor))
      .rejects.toThrow('transient failure');
    const completed = await runExecutionAttempt(executionId, 2, 3, flakyExecutor);
    expect(completed.status).toBe('SUCCEEDED');

    const response = await request
      .get('/api/analytics/executions/' + executionId)
      .set(authHeader(owner.token));

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('SUCCEEDED');
    expect(response.body.retryCount).toBe(1);
    expect(response.body.attemptsMade).toBe(2);
    expect(response.body.nodeCount).toBe(2);
    expect(typeof response.body.durationMs).toBe('number');
    expect(response.body.nodes).toEqual([
      { nodeId: 'log', status: 'SUCCEEDED', durationMs: 1000 },
      { nodeId: 'trigger', status: 'SUCCEEDED', durationMs: 1000 },
    ]);

    const recorded = await ExecutionAnalyticsModel.findOne({ executionId });
    expect(recorded?.status).toBe('SUCCEEDED');
    expect(recorded?.retryCount).toBe(1);
    expect(recorded?.nodeCount).toBe(2);
  });

  it('tracks replay counts on the source workflow', async () => {
    const workflowId = await createWorkflow('Replay workflow');
    const executionId = await queueExecution(workflowId, 'replay-1');
    await expect(runExecutionAttempt(executionId, 1, 1, failingExecutor()))
      .rejects.toThrow('downstream failure');

    const replayed = await request
      .post('/api/executions/' + executionId + '/replay')
      .set(authHeader(owner.token));
    expect(replayed.status).toBe(202);

    const response = await request
      .get('/api/analytics/workflows/' + workflowId)
      .set(authHeader(owner.token));
    expect(response.status).toBe(200);
    expect(response.body.totalExecutions).toBe(1);
    expect(response.body.replayCount).toBe(1);
  });

  it('tracks workspace usage across workflows', async () => {
    const firstWorkflow = await createWorkflow('Usage workflow one');
    const secondWorkflow = await createWorkflow('Usage workflow two');
    const first = await queueExecution(firstWorkflow, 'usage-1');
    const second = await queueExecution(secondWorkflow, 'usage-2');
    await runExecutionAttempt(first, 1, 3);
    await expect(runExecutionAttempt(second, 1, 1, failingExecutor()))
      .rejects.toThrow('downstream failure');

    const response = await request
      .get('/api/analytics/workspaces/' + workspaceId)
      .set(authHeader(owner.token));

    expect(response.status).toBe(200);
    expect(response.body.workspaceId).toBe(workspaceId);
    expect(response.body.totalWorkflows).toBe(2);
    expect(response.body.totalExecutions).toBe(2);
    expect(response.body.monthlyExecutions).toBe(2);
    expect(response.body.successRate).toBe(0.5);
    expect(typeof response.body.averageExecutionTime).toBe('number');
    expect(response.body.storageUsed).toBeGreaterThan(0);
    expect(typeof response.body.updatedAt).toBe('string');
  });

  it('enforces permissions and hides analytics from other tenants', async () => {
    const workflowId = await createWorkflow('Protected workflow');
    const executionId = await queueExecution(workflowId, 'rbac-1');
    await runExecutionAttempt(executionId, 1, 3);

    const viewerWorkflow = await request
      .get('/api/analytics/workflows/' + workflowId)
      .set(authHeader(viewer.token));
    expect(viewerWorkflow.status).toBe(200);

    const viewerExecution = await request
      .get('/api/analytics/executions/' + executionId)
      .set(authHeader(viewer.token));
    expect(viewerExecution.status).toBe(200);

    const viewerWorkspace = await request
      .get('/api/analytics/workspaces/' + workspaceId)
      .set(authHeader(viewer.token));
    expect(viewerWorkspace.status).toBe(403);
    expect(viewerWorkspace.body.error.code).toBe('FORBIDDEN');

    const editorWorkspace = await request
      .get('/api/analytics/workspaces/' + workspaceId)
      .set(authHeader(editor.token));
    expect(editorWorkspace.status).toBe(403);
    expect(editorWorkspace.body.error.code).toBe('FORBIDDEN');

    const ownerWorkspace = await request
      .get('/api/analytics/workspaces/' + workspaceId)
      .set(authHeader(owner.token));
    expect(ownerWorkspace.status).toBe(200);

    const outsiderWorkflow = await request
      .get('/api/analytics/workflows/' + workflowId)
      .set(authHeader(outsider.token));
    expect(outsiderWorkflow.status).toBe(404);
    expect(outsiderWorkflow.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const outsiderExecution = await request
      .get('/api/analytics/executions/' + executionId)
      .set(authHeader(outsider.token));
    expect(outsiderExecution.status).toBe(404);
    expect(outsiderExecution.body.error.code).toBe('EXECUTION_NOT_FOUND');

    const outsiderWorkspace = await request
      .get('/api/analytics/workspaces/' + workspaceId)
      .set(authHeader(outsider.token));
    expect(outsiderWorkspace.status).toBe(404);
    expect(outsiderWorkspace.body.error.code).toBe('WORKSPACE_NOT_FOUND');

    const anonymous = await supertest(createApp({ executionQueue: queue, auth: authConfig }))
      .get('/api/analytics/workflows/' + workflowId);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('validates analytics identifiers and unknown resources', async () => {
    const invalidWorkflow = await request
      .get('/api/analytics/workflows/not-an-id')
      .set(authHeader(owner.token));
    expect(invalidWorkflow.status).toBe(400);
    expect(invalidWorkflow.body.error.code).toBe('INVALID_WORKFLOW_ID');

    const invalidExecution = await request
      .get('/api/analytics/executions/not-an-id')
      .set(authHeader(owner.token));
    expect(invalidExecution.status).toBe(400);
    expect(invalidExecution.body.error.code).toBe('INVALID_EXECUTION_ID');

    const invalidWorkspace = await request
      .get('/api/analytics/workspaces/not-an-id')
      .set(authHeader(owner.token));
    expect(invalidWorkspace.status).toBe(400);
    expect(invalidWorkspace.body.error.code).toBe('INVALID_WORKSPACE_ID');

    const missingWorkflow = await request
      .get('/api/analytics/workflows/507f1f77bcf86cd799439011')
      .set(authHeader(owner.token));
    expect(missingWorkflow.status).toBe(404);
    expect(missingWorkflow.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const missingExecution = await request
      .get('/api/analytics/executions/507f1f77bcf86cd799439011')
      .set(authHeader(owner.token));
    expect(missingExecution.status).toBe(404);
    expect(missingExecution.body.error.code).toBe('EXECUTION_NOT_FOUND');

    const missingWorkspace = await request
      .get('/api/analytics/workspaces/507f1f77bcf86cd799439011')
      .set(authHeader(owner.token));
    expect(missingWorkspace.status).toBe(404);
    expect(missingWorkspace.body.error.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('recalculates analytics from stored executions', async () => {
    const workflowId = await createWorkflow('Recalculated workflow');
    const first = await queueExecution(workflowId, 'recalc-1');
    const second = await queueExecution(workflowId, 'recalc-2');
    await runExecutionAttempt(first, 1, 3);
    await expect(runExecutionAttempt(second, 1, 1, failingExecutor()))
      .rejects.toThrow('downstream failure');

    await WorkflowAnalyticsModel.deleteMany({});
    await ExecutionAnalyticsModel.deleteMany({});
    await WorkspaceUsageModel.deleteMany({});
    expect(await WorkflowAnalyticsModel.countDocuments({})).toBe(0);

    const summary = await recalculateAnalytics(workspaceId);
    expect(summary).toEqual({ workflows: 1, executions: 2, workspaces: 1 });

    const workflowAnalytics = await WorkflowAnalyticsModel.findOne({ workflowId });
    expect(workflowAnalytics?.totalExecutions).toBe(2);
    expect(workflowAnalytics?.successfulExecutions).toBe(1);
    expect(workflowAnalytics?.failedExecutions).toBe(1);
    expect(workflowAnalytics?.averageDurationMs).toBeGreaterThanOrEqual(0);

    const usage = await WorkspaceUsageModel.findOne({ workspaceId });
    expect(usage?.totalWorkflows).toBe(1);
    expect(usage?.totalExecutions).toBe(2);
    expect(usage?.monthlyExecutions).toBe(2);
    expect(usage?.successRate).toBe(0.5);
    expect(usage?.storageUsed ?? 0).toBeGreaterThan(0);

    const executionRows = await ExecutionAnalyticsModel.find({ workflowId });
    expect(executionRows).toHaveLength(2);
    expect(executionRows.every(row => row.nodeCount === 2)).toBe(true);

    const response = await request
      .get('/api/analytics/workflows/' + workflowId)
      .set(authHeader(owner.token));
    expect(response.body.totalExecutions).toBe(2);
  });

  it('records an execution outcome exactly once', async () => {
    const workflowId = await createWorkflow('Idempotent workflow');
    const executionId = await queueExecution(workflowId, 'idempotent-1');
    const completed = await runExecutionAttempt(executionId, 1, 3);
    expect(completed.status).toBe('SUCCEEDED');

    await recordExecutionOutcome(completed);

    expect(await ExecutionAnalyticsModel.countDocuments({ workflowId })).toBe(1);
    const analytics = await WorkflowAnalyticsModel.findOne({ workflowId });
    expect(analytics?.totalExecutions).toBe(1);
    expect(analytics?.successfulExecutions).toBe(1);

    const usage = await WorkspaceUsageModel.findOne({ workspaceId });
    expect(usage?.totalExecutions).toBe(1);
  });
});

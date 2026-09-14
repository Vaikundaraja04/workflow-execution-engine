import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';
import { createApp } from '../src/api/app.js';
import { executeWorkflow } from '../src/engine/executeWorkflow.js';
import { BullMqExecutionQueue } from '../src/queues/bullMqExecutionQueue.js';
import type {
  ExecutionEnqueueOptions,
  ExecutionJobData,
  ExecutionQueue,
} from '../src/queues/executionQueue.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import {
  createWorkflowExecution,
  recoverPendingExecutions,
  runExecutionAttempt,
} from '../src/services/executionService.js';
import type { ExecutionResult, WorkflowDefinition } from '../src/types/workflow.js';
import type { CreateExecutionRequest } from '../src/schemas/executionSchema.js';
import { createExecutionWorker } from '../src/workers/executionWorker.js';

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

let replSet: MongoMemoryReplSet;
let redisServer: RedisMemoryServer;
let redisUrl: string;
let request: ReturnType<typeof supertest>;
const queue = new RecordingQueue();
const liveQueues: ExecutionQueue[] = [];
const liveWorkers: Array<ReturnType<typeof createExecutionWorker>> = [];

function validDefinition(message = 'phase-2c') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  } satisfies WorkflowDefinition;
}

async function createPublishedWorkflow(message = 'phase-2c'): Promise<string> {
  const workflow = await WorkflowModel.create({
    name: 'Executable workflow',
    draftDefinition: validDefinition(message),
    status: 'DRAFT',
    latestVersionNumber: 0,
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
  idempotencyKey = 'booking-1',
  input: CreateExecutionRequest['input'] = { estimatedCost: 15_000 },
) {
  return createWorkflowExecution(queue, workflowId, { idempotencyKey, input }, {
    attempts: 3,
    backoffMs: 10,
  });
}

async function waitForTerminalExecution(
  executionId: string,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const execution = await WorkflowExecutionModel.findById(executionId);
    if (execution?.status === 'SUCCEEDED' || execution?.status === 'FAILED') return execution;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for terminal execution');
}

beforeAll(async () => {
  const platformArgs = process.platform === 'win32' || process.env.MONGOMS_SYSTEM_BINARY
    ? []
    : ['--nounixsocket'];
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, args: platformArgs },
  });
  redisServer = await RedisMemoryServer.create();
  redisUrl = `redis://${await redisServer.getHost()}:${await redisServer.getPort()}`;
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({
    executionQueue: queue,
    executionCreationOptions: { attempts: 3, backoffMs: 10 },
  }));
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (redisServer) await redisServer.stop();
  if (replSet) await replSet.stop();
}, 30_000);

beforeEach(async () => {
  queue.jobs = [];
  queue.shouldFail = false;
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
});

afterEach(async () => {
  await Promise.all(liveWorkers.splice(0).map(worker => worker.close()));
  await Promise.all(liveQueues.splice(0).map(executionQueue => executionQueue.close()));
});

describe('Phase 2C execution API and runtime', () => {
  it('queues the latest published workflow version', async () => {
    const workflowId = await createPublishedWorkflow();
    const response = await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'booking-1', input: { estimatedCost: 15_000 } });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('QUEUED');
    expect(response.body.versionNumber).toBe(1);
    expect(response.body.replayed).toBe(false);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.options).toMatchObject({ attempts: 3, backoffMs: 10 });
  });

  it('rejects an invalid workflow ID', async () => {
    const response = await request
      .post('/api/workflows/not-an-id/executions')
      .send({ idempotencyKey: 'booking-1' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_WORKFLOW_ID');
  });

  it('rejects a missing workflow', async () => {
    const response = await request
      .post('/api/workflows/507f1f77bcf86cd799439011/executions')
      .send({ idempotencyKey: 'booking-1' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('rejects a workflow without a published version', async () => {
    const workflow = await WorkflowModel.create({
      name: 'Draft only',
      draftDefinition: validDefinition(),
      status: 'DRAFT',
      latestVersionNumber: 0,
    });
    const response = await request
      .post(`/api/workflows/${workflow._id.toString()}/executions`)
      .send({ idempotencyKey: 'booking-1' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NO_PUBLISHED_VERSION');
  });

  it('strictly validates execution request bodies', async () => {
    const workflowId = await createPublishedWorkflow();
    const response = await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'booking-1', unexpected: true });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('replays the same idempotent request without a second job', async () => {
    const workflowId = await createPublishedWorkflow();
    const first = await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'booking-1', input: { a: 1, b: 2 } });
    const second = await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'booking-1', input: { b: 2, a: 1 } });

    expect(second.status).toBe(202);
    expect(second.body.executionId).toBe(first.body.executionId);
    expect(second.body.replayed).toBe(true);
    expect(queue.jobs).toHaveLength(1);
  });

  it('collapses concurrent idempotent submissions into one execution', async () => {
    const workflowId = await createPublishedWorkflow();
    await WorkflowExecutionModel.init();

    const [first, second] = await Promise.all([
      queueExecution(workflowId, 'concurrent-key', { request: 1 }),
      queueExecution(workflowId, 'concurrent-key', { request: 1 }),
    ]);

    expect(second.execution._id.toString()).toBe(first.execution._id.toString());
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(queue.jobs).toHaveLength(1);
    expect(await WorkflowExecutionModel.countDocuments({ workflowId })).toBe(1);
  });

  it('rejects incompatible reuse of an idempotency key', async () => {
    const workflowId = await createPublishedWorkflow();
    await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'booking-1', input: { estimatedCost: 15_000 } });
    const response = await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'booking-1', input: { estimatedCost: 5_000 } });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('persists a safe failure when enqueueing fails', async () => {
    const workflowId = await createPublishedWorkflow();
    queue.shouldFail = true;
    const response = await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'queue-failure' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('QUEUE_UNAVAILABLE');
    const stored = await WorkflowExecutionModel.findOne({ idempotencyKey: 'queue-failure' });
    expect(stored?.status).toBe('FAILED');
    expect(stored?.error).toEqual({
      code: 'QUEUE_UNAVAILABLE',
      message: 'Execution could not be queued',
    });
  });

  it('retries the same execution after a temporary enqueue failure', async () => {
    const workflowId = await createPublishedWorkflow();
    queue.shouldFail = true;
    await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'queue-retry', input: { request: 1 } });
    const failed = await WorkflowExecutionModel.findOne({ idempotencyKey: 'queue-retry' });
    if (!failed) throw new Error('Failed execution was not persisted');

    queue.shouldFail = false;
    const retried = await request
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'queue-retry', input: { request: 1 } });

    expect(retried.status).toBe(202);
    expect(retried.body.executionId).toBe(failed._id.toString());
    expect(retried.body.status).toBe('QUEUED');
    expect(retried.body.replayed).toBe(true);
    expect(queue.jobs).toHaveLength(1);
  });

  it('retrieves a persisted execution by ID', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId);
    const response = await request.get(`/api/executions/${created.execution._id.toString()}`);
    expect(response.status).toBe(200);
    expect(response.body.executionId).toBe(created.execution._id.toString());
    expect(response.body.statusHistory.map((event: { status: string }) => event.status))
      .toEqual(['QUEUING', 'QUEUED']);
  });

  it('returns safe errors for invalid and missing execution IDs', async () => {
    const invalid = await request.get('/api/executions/not-an-id');
    const missing = await request.get('/api/executions/507f1f77bcf86cd799439011');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_EXECUTION_ID');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('EXECUTION_NOT_FOUND');
  });

  it('lists workflow executions newest first', async () => {
    const workflowId = await createPublishedWorkflow();
    const first = await queueExecution(workflowId, 'first');
    await WorkflowExecutionModel.updateOne(
      { _id: first.execution._id },
      { $set: { createdAt: new Date('2026-01-01T00:00:00.000Z') } },
    );
    const second = await queueExecution(workflowId, 'second');

    const response = await request.get(`/api/workflows/${workflowId}/executions`);
    expect(response.status).toBe(200);
    expect(response.body.map((execution: { executionId: string }) => execution.executionId))
      .toEqual([second.execution._id.toString(), first.execution._id.toString()]);
  });

  it('returns safe errors when execution history uses an invalid or missing workflow ID', async () => {
    const invalid = await request.get('/api/workflows/not-an-id/executions');
    const missing = await request.get('/api/workflows/507f1f77bcf86cd799439011/executions');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_WORKFLOW_ID');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('runs the existing engine and persists a successful result', async () => {
    const workflowId = await createPublishedWorkflow('persisted output');
    const created = await queueExecution(workflowId);
    const completed = await runExecutionAttempt(created.execution._id.toString(), 1, 3);

    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.result?.outputs.log).toEqual({ message: 'persisted output' });
    expect(completed.finishedAt).toBeInstanceOf(Date);
  });

  it('executes the pinned version even when the workflow publishes a newer one', async () => {
    const workflowId = await createPublishedWorkflow('version one');
    const created = await queueExecution(workflowId);
    const workflow = await WorkflowModel.findById(workflowId);
    if (!workflow) throw new Error('Test workflow missing');
    const secondVersion = await WorkflowVersionModel.create({
      workflowId: workflow._id,
      versionNumber: 2,
      definition: validDefinition('version two'),
    });
    workflow.latestVersionNumber = 2;
    workflow.publishedVersionId = secondVersion._id;
    await workflow.save();

    const completed = await runExecutionAttempt(created.execution._id.toString(), 1, 3);
    expect(completed.versionNumber).toBe(1);
    expect(completed.result?.outputs.log).toEqual({ message: 'version one' });
  });

  it('returns a transient failure to QUEUED before retrying successfully', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId);
    let calls = 0;
    const executor = async (): Promise<ExecutionResult> => {
      calls += 1;
      if (calls === 1) throw new Error('temporary dependency failure');
      return {
        status: 'SUCCEEDED',
        stepStatuses: {},
        outputs: { retried: true },
        executionHistory: [],
      };
    };

    await expect(runExecutionAttempt(created.execution._id.toString(), 1, 3, executor))
      .rejects.toThrow('temporary dependency failure');
    expect((await WorkflowExecutionModel.findById(created.execution._id))?.status).toBe('QUEUED');

    const completed = await runExecutionAttempt(created.execution._id.toString(), 2, 3, executor);
    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.attemptsMade).toBe(2);
  });

  it('persists a safe terminal failure after retries are exhausted', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId);
    const executor = async (): Promise<ExecutionResult> => {
      throw new Error('private upstream details');
    };

    await expect(runExecutionAttempt(created.execution._id.toString(), 1, 2, executor))
      .rejects.toThrow('private upstream details');
    await expect(runExecutionAttempt(created.execution._id.toString(), 2, 2, executor))
      .rejects.toThrow('private upstream details');

    const failed = await WorkflowExecutionModel.findById(created.execution._id);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error).toEqual({
      code: 'EXECUTION_FAILED',
      message: 'Workflow execution failed after all retry attempts',
    });
    expect(JSON.stringify(failed?.error)).not.toContain('private upstream details');
  });

  it('reclaims a RUNNING record after a worker restart', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId);
    await WorkflowExecutionModel.updateOne(
      { _id: created.execution._id },
      { $set: { status: 'RUNNING', attemptsMade: 1 } },
    );

    const completed = await runExecutionAttempt(created.execution._id.toString(), 2, 3);
    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.attemptsMade).toBe(2);
  });

  it('re-enqueues an execution stranded during queue handoff', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId, 'recover-queuing');
    await WorkflowExecutionModel.updateOne(
      { _id: created.execution._id },
      { $set: { status: 'QUEUING' } },
    );
    queue.jobs = [];

    const recovery = await recoverPendingExecutions(queue, { attempts: 3, backoffMs: 10 });

    expect(recovery).toEqual({ examined: 1, recovered: 1, failed: 0 });
    expect(queue.jobs[0]?.data.executionId).toBe(created.execution._id.toString());
    expect((await WorkflowExecutionModel.findById(created.execution._id))?.status).toBe('QUEUED');
  });

  it('does not execute a terminal record twice', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId);
    let calls = 0;
    const executor = async (): Promise<ExecutionResult> => {
      calls += 1;
      return {
        status: 'SUCCEEDED',
        stepStatuses: {},
        outputs: {},
        executionHistory: [],
      };
    };

    await runExecutionAttempt(created.execution._id.toString(), 1, 3, executor);
    await runExecutionAttempt(created.execution._id.toString(), 2, 3, executor);
    expect(calls).toBe(1);
  });

  it('fails safely when the pinned version has been removed', async () => {
    const workflowId = await createPublishedWorkflow();
    const created = await queueExecution(workflowId);
    await WorkflowVersionModel.deleteMany({ workflowId });
    const failed = await runExecutionAttempt(created.execution._id.toString(), 1, 3);
    expect(failed.status).toBe('FAILED');
    expect(failed.error?.code).toBe('WORKFLOW_VERSION_NOT_FOUND');
  });

  it('runs end to end through the real BullMQ adapter and worker', async () => {
    const workflowId = await createPublishedWorkflow('end-to-end');
    const queueName = `execution-e2e-${randomUUID()}`;
    const liveQueue = new BullMqExecutionQueue(redisUrl, queueName);
    liveQueues.push(liveQueue);
    await liveQueue.waitUntilReady();
    const liveRequest = supertest(createApp({
      executionQueue: liveQueue,
      executionCreationOptions: { attempts: 3, backoffMs: 10 },
    }));

    const queued = await liveRequest
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'e2e-success', input: { estimatedCost: 15_000 } });
    expect(queued.status).toBe(202);
    expect(queued.body.status).toBe('QUEUED');

    const worker = createExecutionWorker(redisUrl, { queueName, concurrency: 1 });
    liveWorkers.push(worker);
    await worker.waitUntilReady();
    const completed = await waitForTerminalExecution(queued.body.executionId);

    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.result?.outputs.log).toEqual({ message: 'end-to-end' });

  });

  it('retries transient failures end to end through BullMQ', async () => {
    const workflowId = await createPublishedWorkflow('retry success');
    const queueName = `execution-retry-${randomUUID()}`;
    const liveQueue = new BullMqExecutionQueue(redisUrl, queueName);
    liveQueues.push(liveQueue);
    await liveQueue.waitUntilReady();
    let calls = 0;
    const executor = async (
      definition: WorkflowDefinition,
      input: Record<string, unknown>,
    ): Promise<ExecutionResult> => {
      calls += 1;
      if (calls === 1) throw new Error('temporary service outage');
      return executeWorkflow(definition, input);
    };
    const liveRequest = supertest(createApp({
      executionQueue: liveQueue,
      executionCreationOptions: { attempts: 3, backoffMs: 10 },
    }));

    const queued = await liveRequest
      .post(`/api/workflows/${workflowId}/executions`)
      .send({ idempotencyKey: 'e2e-retry', input: {} });
    const worker = createExecutionWorker(redisUrl, {
      queueName,
      concurrency: 1,
      executor,
    });
    liveWorkers.push(worker);
    await worker.waitUntilReady();
    const completed = await waitForTerminalExecution(queued.body.executionId);

    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.attemptsMade).toBe(2);
    expect(calls).toBe(2);

  });
});

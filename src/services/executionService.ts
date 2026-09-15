import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { executeWorkflow } from '../engine/executeWorkflow.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import {
  WorkflowExecutionModel,
} from '../models/WorkflowExecutionModel.js';
import type { IWorkflowExecution } from '../models/WorkflowExecutionModel.js';
import type { CreateExecutionRequest } from '../schemas/executionSchema.js';
import type { ExecutionResult, WorkflowDefinition } from '../types/workflow.js';
import type {
  StoredExecutionError,
  WorkflowExecutionView,
} from '../types/execution.js';
import type { ExecutionQueue } from '../queues/executionQueue.js';
import {
  createExecutionJobId,
  DEFAULT_EXECUTION_ATTEMPTS,
  DEFAULT_EXECUTION_BACKOFF_MS,
} from '../queues/executionQueue.js';

export interface ExecutionCreationOptions {
  attempts?: number;
  backoffMs?: number;
}

export interface CreatedExecution {
  execution: IWorkflowExecution;
  replayed: boolean;
}

export type WorkflowExecutor = (
  workflow: WorkflowDefinition,
  input: Record<string, unknown>,
) => Promise<ExecutionResult>;

function assertValidId(id: string, errorCode: string): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error(errorCode);
  }
}
function tenantScope(userId: string, workspaceId: string) {
  return {
    $or: [
      { workspaceId: new Types.ObjectId(workspaceId) },
      { workspaceId: { $exists: false }, ownerId: new Types.ObjectId(userId) },
      { workspaceId: null, ownerId: new Types.ObjectId(userId) },
    ],
  };
}

function executionScope(userId: string, workspaceId: string) {
  return {
    $or: [
      { workspaceId: new Types.ObjectId(workspaceId) },
      { workspaceId: { $exists: false }, ownerId: new Types.ObjectId(userId) },
      { workspaceId: null, ownerId: new Types.ObjectId(userId) },
    ],
  };
}

function encodeJson(value: unknown): string {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') throw new Error('INVALID_JSON_VALUE');
    return encoded;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_JSON_VALUE');
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => encodeJson(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const properties = Object.entries(value)
      .sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1)
      .map(([key, propertyValue]) => `${encodeJson(key)}:${encodeJson(propertyValue)}`);
    return `{${properties.join(',')}}`;
  }

  throw new Error('INVALID_JSON_VALUE');
}

export function hashExecutionInput(input: Record<string, unknown>): string {
  return createHash('sha256').update(encodeJson(input)).digest('hex');
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 11000;
}

function sameIdempotentRequest(execution: IWorkflowExecution, inputHash: string): boolean {
  return execution.inputHash === inputHash;
}

async function findIdempotentExecution(
  workflowId: string,
  idempotencyKey: string,
): Promise<IWorkflowExecution | null> {
  return WorkflowExecutionModel.findOne({ workflowId, idempotencyKey });
}

function getEnqueueOptions(
  execution: IWorkflowExecution,
  options: ExecutionCreationOptions,
) {
  return {
    jobId: execution.jobId,
    attempts: options.attempts ?? DEFAULT_EXECUTION_ATTEMPTS,
    backoffMs: options.backoffMs ?? DEFAULT_EXECUTION_BACKOFF_MS,
  };
}

async function enqueuePersistedExecution(
  queue: ExecutionQueue,
  execution: IWorkflowExecution,
  options: ExecutionCreationOptions,
): Promise<IWorkflowExecution> {
  try {
    await queue.enqueue(
      { executionId: execution._id.toString() },
      getEnqueueOptions(execution, options),
    );
  } catch {
    const failedAt = new Date();
    await WorkflowExecutionModel.findOneAndUpdate(
      { _id: execution._id, status: 'QUEUING' },
      {
        $set: {
          status: 'FAILED',
          error: { code: 'QUEUE_UNAVAILABLE', message: 'Execution could not be queued' },
          finishedAt: failedAt,
        },
        $push: { statusHistory: { status: 'FAILED', timestamp: failedAt } },
      },
    );
    throw new Error('QUEUE_UNAVAILABLE');
  }

  const queuedAt = new Date();
  const queuedExecution = await WorkflowExecutionModel.findOneAndUpdate(
    { _id: execution._id, status: 'QUEUING' },
    {
      $set: { status: 'QUEUED', queuedAt },
      $unset: { error: 1, finishedAt: 1 },
      $push: { statusHistory: { status: 'QUEUED', timestamp: queuedAt } },
    },
    { returnDocument: 'after' },
  );

  if (queuedExecution) return queuedExecution;
  const current = await WorkflowExecutionModel.findById(execution._id);
  if (!current) throw new Error('EXECUTION_NOT_FOUND');
  return current;
}

async function replayIdempotentExecution(
  queue: ExecutionQueue,
  execution: IWorkflowExecution,
  inputHash: string,
  options: ExecutionCreationOptions,
): Promise<CreatedExecution> {
  if (!sameIdempotentRequest(execution, inputHash)) {
    throw new Error('IDEMPOTENCY_CONFLICT');
  }

  if (execution.status !== 'FAILED' || execution.error?.code !== 'QUEUE_UNAVAILABLE') {
    return { execution, replayed: true };
  }

  const retryAt = new Date();
  const retryable = await WorkflowExecutionModel.findOneAndUpdate(
    {
      _id: execution._id,
      status: 'FAILED',
      'error.code': 'QUEUE_UNAVAILABLE',
    },
    {
      $set: { status: 'QUEUING' },
      $unset: { error: 1, finishedAt: 1 },
      $push: { statusHistory: { status: 'QUEUING', timestamp: retryAt } },
    },
    { returnDocument: 'after' },
  );

  if (!retryable) {
    const current = await WorkflowExecutionModel.findById(execution._id);
    if (!current) throw new Error('EXECUTION_NOT_FOUND');
    return { execution: current, replayed: true };
  }

  return {
    execution: await enqueuePersistedExecution(queue, retryable, options),
    replayed: true,
  };
}

export async function createWorkflowExecution(
  queue: ExecutionQueue,
  workflowId: string,
  request: CreateExecutionRequest,
  ownerId: string,
  workspaceId: string,
  options: ExecutionCreationOptions = {},
): Promise<CreatedExecution> {
  assertValidId(workflowId, 'INVALID_WORKFLOW_ID');

  const workflow = await WorkflowModel.findOne({ _id: workflowId, ...tenantScope(ownerId, workspaceId) });
  if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

  const inputHash = hashExecutionInput(request.input);
  const existing = await findIdempotentExecution(workflowId, request.idempotencyKey);
  if (existing) {
    return replayIdempotentExecution(queue, existing, inputHash, options);
  }

  if (!workflow.publishedVersionId || workflow.latestVersionNumber < 1) {
    throw new Error('NO_PUBLISHED_VERSION');
  }

  const version = await WorkflowVersionModel.findOne({
    _id: workflow.publishedVersionId,
    workflowId: workflow._id,
  });
  if (!version) throw new Error('PUBLISHED_VERSION_NOT_FOUND');

  const executionId = new Types.ObjectId();
  const jobId = createExecutionJobId(executionId.toString());
  const createdAt = new Date();
  let execution: IWorkflowExecution;

  try {
    execution = await WorkflowExecutionModel.create({
      _id: executionId,
      workflowId: workflow._id,
      ownerId: workflow.ownerId,
      ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}),
      workflowVersionId: version._id,
      versionNumber: version.versionNumber,
      jobId,
      idempotencyKey: request.idempotencyKey,
      inputHash,
      input: structuredClone(request.input),
      status: 'QUEUING',
      attemptsMade: 0,
      statusHistory: [{ status: 'QUEUING', timestamp: createdAt }],
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const racedExecution = await findIdempotentExecution(workflowId, request.idempotencyKey);
    if (!racedExecution) throw new Error('IDEMPOTENCY_CONFLICT');
    return replayIdempotentExecution(queue, racedExecution, inputHash, options);
  }
  execution = await enqueuePersistedExecution(queue, execution, options);
  return { execution, replayed: false };
}

export async function getWorkflowExecution(executionId: string, ownerId: string, workspaceId: string): Promise<IWorkflowExecution> {
  assertValidId(executionId, 'INVALID_EXECUTION_ID');
  const execution = await WorkflowExecutionModel.findOne({ _id: executionId, ...executionScope(ownerId, workspaceId) });
  if (!execution) throw new Error('EXECUTION_NOT_FOUND');
  return execution;
}

export async function listWorkflowExecutions(workflowId: string, ownerId: string, workspaceId: string): Promise<IWorkflowExecution[]> {
  assertValidId(workflowId, 'INVALID_WORKFLOW_ID');
  const workflowExists = await WorkflowModel.exists({ _id: workflowId, ...tenantScope(ownerId, workspaceId) });
  if (!workflowExists) throw new Error('WORKFLOW_NOT_FOUND');
  return WorkflowExecutionModel.find({ workflowId }).sort({ createdAt: -1 });
}

export interface ExecutionRecoverySummary {
  examined: number;
  recovered: number;
  failed: number;
}

export async function recoverPendingExecutions(
  queue: ExecutionQueue,
  options: ExecutionCreationOptions = {},
): Promise<ExecutionRecoverySummary> {
  const candidates = await WorkflowExecutionModel.find({
    $or: [
      { status: 'QUEUING' },
      { status: 'FAILED', 'error.code': 'QUEUE_UNAVAILABLE' },
    ],
  }).sort({ createdAt: 1 }).limit(1_000);

  let recovered = 0;
  let failed = 0;

  for (const candidate of candidates) {
    let execution = candidate;
    if (candidate.status === 'FAILED') {
      const retryAt = new Date();
      const retryable = await WorkflowExecutionModel.findOneAndUpdate(
        {
          _id: candidate._id,
          status: 'FAILED',
          'error.code': 'QUEUE_UNAVAILABLE',
        },
        {
          $set: { status: 'QUEUING' },
          $unset: { error: 1, finishedAt: 1 },
          $push: { statusHistory: { status: 'QUEUING', timestamp: retryAt } },
        },
        { returnDocument: 'after' },
      );
      if (!retryable) continue;
      execution = retryable;
    }

    try {
      await enqueuePersistedExecution(queue, execution, options);
      recovered += 1;
    } catch {
      failed += 1;
    }
  }

  return { examined: candidates.length, recovered, failed };
}

async function persistTerminalResult(
  executionId: Types.ObjectId,
  attemptNumber: number,
  result: ExecutionResult,
): Promise<IWorkflowExecution> {
  const finishedAt = new Date();
  const succeeded = result.status === 'SUCCEEDED';
  const error: StoredExecutionError | undefined = succeeded
    ? undefined
    : {
        code: result.errors?.[0]?.code ?? 'WORKFLOW_EXECUTION_FAILED',
        message: 'Workflow execution failed',
      };

  const setValues: Record<string, unknown> = {
    status: result.status,
    result,
    finishedAt,
  };
  if (error) setValues.error = error;

  const execution = await WorkflowExecutionModel.findOneAndUpdate(
    { _id: executionId, status: 'RUNNING', attemptsMade: attemptNumber },
    {
      $set: setValues,
      $push: {
        statusHistory: {
          status: result.status,
          timestamp: finishedAt,
          attempt: attemptNumber,
        },
      },
    },
    { returnDocument: 'after' },
  );

  if (!execution) throw new Error('EXECUTION_STATE_CONFLICT');
  return execution;
}

export async function markExecutionFailed(
  executionId: string,
  error: StoredExecutionError,
  attemptNumber: number,
): Promise<IWorkflowExecution | null> {
  assertValidId(executionId, 'INVALID_EXECUTION_ID');
  const finishedAt = new Date();
  return WorkflowExecutionModel.findOneAndUpdate(
    { _id: executionId, status: { $nin: ['SUCCEEDED', 'FAILED'] } },
    {
      $set: {
        status: 'FAILED',
        error,
        attemptsMade: attemptNumber,
        finishedAt,
      },
      $push: {
        statusHistory: {
          status: 'FAILED',
          timestamp: finishedAt,
          attempt: attemptNumber,
        },
      },
    },
    { returnDocument: 'after' },
  );
}

export async function runExecutionAttempt(
  executionId: string,
  attemptNumber: number,
  maxAttempts: number,
  executor: WorkflowExecutor = executeWorkflow,
): Promise<IWorkflowExecution> {
  assertValidId(executionId, 'INVALID_EXECUTION_ID');
  const startedAt = new Date();
  const claimed = await WorkflowExecutionModel.findOneAndUpdate(
    {
      _id: executionId,
      status: { $in: ['QUEUING', 'QUEUED', 'RUNNING'] },
      attemptsMade: { $lt: attemptNumber },
    },
    {
      $set: {
        status: 'RUNNING',
        attemptsMade: attemptNumber,
        startedAt,
      },
      $push: {
        statusHistory: {
          status: 'RUNNING',
          timestamp: startedAt,
          attempt: attemptNumber,
        },
      },
    },
    { returnDocument: 'after' },
  );

  if (!claimed) {
    const existing = await WorkflowExecutionModel.findById(executionId);
    if (!existing) throw new Error('EXECUTION_NOT_FOUND');
    return existing;
  }

  try {
    const version = await WorkflowVersionModel.findOne({
      _id: claimed.workflowVersionId,
      workflowId: claimed.workflowId,
    });

    if (!version) {
      const failed = await markExecutionFailed(
        executionId,
        { code: 'WORKFLOW_VERSION_NOT_FOUND', message: 'Published workflow version was not found' },
        attemptNumber,
      );
      if (!failed) throw new Error('EXECUTION_STATE_CONFLICT');
      return failed;
    }

    const result = await executor(version.definition, structuredClone(claimed.input));
    return persistTerminalResult(claimed._id, attemptNumber, result);
  } catch (error) {
    if (error instanceof Error && error.message === 'EXECUTION_STATE_CONFLICT') {
      throw error;
    }

    if (attemptNumber >= maxAttempts) {
      await markExecutionFailed(
        executionId,
        { code: 'EXECUTION_FAILED', message: 'Workflow execution failed after all retry attempts' },
        attemptNumber,
      );
    } else {
      const queuedAt = new Date();
      await WorkflowExecutionModel.findOneAndUpdate(
        { _id: executionId, status: 'RUNNING', attemptsMade: attemptNumber },
        {
          $set: { status: 'QUEUED', queuedAt },
          $push: {
            statusHistory: {
              status: 'QUEUED',
              timestamp: queuedAt,
              attempt: attemptNumber,
            },
          },
        },
      );
    }

    throw error instanceof Error ? error : new Error('EXECUTION_FAILED');
  }
}

export function toWorkflowExecutionView(execution: IWorkflowExecution): WorkflowExecutionView {
  const statusHistory = execution.statusHistory.map(event => {
    const view: {
      status: typeof event.status;
      timestamp: string;
      attempt?: number;
    } = {
      status: event.status,
      timestamp: event.timestamp.toISOString(),
    };
    if (event.attempt !== undefined) view.attempt = event.attempt;
    return view;
  });

  const view: WorkflowExecutionView = {
    executionId: execution._id.toString(),
    workflowId: execution.workflowId.toString(),
    workflowVersionId: execution.workflowVersionId.toString(),
    versionNumber: execution.versionNumber,
    jobId: execution.jobId,
    idempotencyKey: execution.idempotencyKey,
    status: execution.status,
    input: execution.input,
    attemptsMade: execution.attemptsMade,
    statusHistory,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };

  if (execution.result !== undefined) view.result = execution.result;
  if (execution.error !== undefined) view.error = execution.error;
  if (execution.queuedAt !== undefined) view.queuedAt = execution.queuedAt.toISOString();
  if (execution.startedAt !== undefined) view.startedAt = execution.startedAt.toISOString();
  if (execution.finishedAt !== undefined) view.finishedAt = execution.finishedAt.toISOString();
  return view;
}

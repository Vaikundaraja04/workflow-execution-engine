import { createHash, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { executeWorkflow } from '../engine/executeWorkflow.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import {
  WorkflowExecutionModel,
} from '../models/WorkflowExecutionModel.js';
import type { IWorkflowExecution } from '../models/WorkflowExecutionModel.js';
import { DeadLetterModel } from '../models/DeadLetterModel.js';
import type { CreateExecutionRequest } from '../schemas/executionSchema.js';
import type { ExecutionResult, WorkflowDefinition } from '../types/workflow.js';
import type {
  ExecutionRetryPolicy,
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
  timeoutMs?: number;
}

export const MAX_EXECUTION_ATTEMPTS = 20;
export const MAX_RETRY_DELAY_MS = 3_600_000;
export const EXECUTION_TIMEOUT_CODE = 'EXECUTION_TIMEOUT';

export function resolveRetryPolicy(
  request: CreateExecutionRequest,
  options: ExecutionCreationOptions,
): { policy: ExecutionRetryPolicy; maxRetries: number } {
  const requested = request.retryPolicy;
  const attemptCap = Math.min(options.attempts ?? DEFAULT_EXECUTION_ATTEMPTS, MAX_EXECUTION_ATTEMPTS);
  const retryCap = Math.max(attemptCap - 1, 0);
  const maxRetries = Math.max(Math.min(requested?.maxRetries ?? retryCap, retryCap), 0);
  const type = requested?.type ?? 'EXPONENTIAL';
  const delayMs = requested?.delayMs ?? options.backoffMs ?? DEFAULT_EXECUTION_BACKOFF_MS;
  const policy: ExecutionRetryPolicy = type === 'FIXED'
    ? { type, delayMs }
    : { type, delayMs, backoffFactor: requested?.backoffFactor ?? 2 };
  return { policy, maxRetries };
}

export function policyOf(execution: { retryPolicy?: ExecutionRetryPolicy | undefined }): ExecutionRetryPolicy {
  const policy = execution.retryPolicy;
  if (!policy) return { type: 'EXPONENTIAL', delayMs: DEFAULT_EXECUTION_BACKOFF_MS, backoffFactor: 2 };
  return policy.type === 'FIXED'
    ? { type: 'FIXED', delayMs: policy.delayMs }
    : { type: 'EXPONENTIAL', delayMs: policy.delayMs, backoffFactor: policy.backoffFactor ?? 2 };
}
export function retryDelayMs(policy: ExecutionRetryPolicy, attemptNumber: number): number {
  if (policy.type === 'FIXED') return policy.delayMs;
  const factor = policy.backoffFactor ?? 2;
  const delay = policy.delayMs * factor ** Math.max(attemptNumber - 1, 0);
  return Math.min(Math.round(delay), MAX_RETRY_DELAY_MS);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === EXECUTION_TIMEOUT_CODE;
}

export async function runWithTimeout<T>(task: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) return task();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(EXECUTION_TIMEOUT_CODE)), timeoutMs);
    task().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
interface DeadLetterTarget {
  _id: Types.ObjectId;
  workflowId?: Types.ObjectId;
  workspaceId?: Types.ObjectId;
}

async function recordDeadLetter(
  execution: DeadLetterTarget,
  failureReason: string,
  message: string,
  attempts: number,
): Promise<void> {
  try {
    await DeadLetterModel.updateOne(
      { executionId: execution._id },
      {
        $setOnInsert: {
          executionId: execution._id,
          ...(execution.workflowId ? { workflowId: execution.workflowId } : {}),
          ...(execution.workspaceId ? { workspaceId: execution.workspaceId } : {}),
          failureReason,
          message,
          attempts,
          failedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('Could not record dead letter entry:', detail);
  }
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
import { tenantScope } from './tenantScope.js';
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
  const policy = execution.retryPolicy ?? {
    type: 'EXPONENTIAL' as const,
    delayMs: options.backoffMs ?? DEFAULT_EXECUTION_BACKOFF_MS,
    backoffFactor: 2,
  };
  const maxRetries = execution.maxRetries ?? Math.max((options.attempts ?? DEFAULT_EXECUTION_ATTEMPTS) - 1, 0);
  return {
    jobId: execution.jobId,
    attempts: maxRetries + 1,
    backoffMs: policy.delayMs,
    backoffType: policy.type === 'FIXED' ? ('fixed' as const) : ('exponential' as const),
    ...(execution.nextRetryAt ? { delayMs: Math.max(execution.nextRetryAt.getTime() - Date.now(), 0) } : {}),
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
  const { policy, maxRetries } = resolveRetryPolicy(request, options);
  const timeoutMs = request.timeoutMs ?? options.timeoutMs;
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
      retryPolicy: policy,
      maxRetries,
      retryCount: 0,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
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
  const execution = await WorkflowExecutionModel.findOne({ _id: executionId, ...tenantScope(ownerId, workspaceId) });
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
  if (!succeeded) {
    await recordDeadLetter(
      execution,
      error?.code ?? 'WORKFLOW_EXECUTION_FAILED',
      error?.message ?? 'Workflow execution failed',
      attemptNumber,
    );
  }
  return execution;
}

export async function markExecutionFailed(
  executionId: string,
  error: StoredExecutionError,
  attemptNumber: number,
): Promise<IWorkflowExecution | null> {
  assertValidId(executionId, 'INVALID_EXECUTION_ID');
  const finishedAt = new Date();
  const failed = await WorkflowExecutionModel.findOneAndUpdate(
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
  if (failed) {
    await recordDeadLetter(failed, error.code, error.message, attemptNumber);
  }
  return failed;
}

export async function runExecutionAttempt(
  executionId: string,
  attemptNumber: number,
  maxAttempts: number,
  executor: WorkflowExecutor = executeWorkflow,
  timeoutMs?: number,
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

    const deadlineMs = timeoutMs ?? claimed.timeoutMs;
    const result = await runWithTimeout(
      () => executor(version.definition, structuredClone(claimed.input)),
      deadlineMs,
    );
    return persistTerminalResult(claimed._id, attemptNumber, result);
  } catch (error) {
    if (error instanceof Error && error.message === 'EXECUTION_STATE_CONFLICT') {
      throw error;
    }

    if (attemptNumber >= maxAttempts) {
      const timedOut = isTimeoutError(error);
      await markExecutionFailed(
        executionId,
        timedOut
          ? { code: EXECUTION_TIMEOUT_CODE, message: 'Workflow execution exceeded its time limit' }
          : { code: 'EXECUTION_FAILED', message: 'Workflow execution failed after all retry attempts' },
        attemptNumber,
      );
    } else {
      const queuedAt = new Date();
      const nextRetryAt = new Date(queuedAt.getTime() + retryDelayMs(policyOf(claimed), attemptNumber));
      await WorkflowExecutionModel.findOneAndUpdate(
        { _id: executionId, status: 'RUNNING', attemptsMade: attemptNumber },
        {
          $set: { status: 'QUEUED', queuedAt, nextRetryAt },
          $inc: { retryCount: 1 },
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

export async function replayWorkflowExecution(
  queue: ExecutionQueue,
  executionId: string,
  ownerId: string,
  workspaceId: string,
  options: ExecutionCreationOptions = {},
): Promise<IWorkflowExecution> {
  assertValidId(executionId, 'INVALID_EXECUTION_ID');

  const original = await WorkflowExecutionModel.findOne({
    _id: executionId,
    ...tenantScope(ownerId, workspaceId),
  });
  if (!original) throw new Error('EXECUTION_NOT_FOUND');
  if (original.status !== 'SUCCEEDED' && original.status !== 'FAILED') {
    throw new Error('EXECUTION_NOT_REPLAYABLE');
  }

  const replayId = new Types.ObjectId();
  const jobId = createExecutionJobId(replayId.toString());
  const createdAt = new Date();
  const timeoutMs = original.timeoutMs ?? options.timeoutMs;
  const replay = await WorkflowExecutionModel.create({
    _id: replayId,
    workflowId: original.workflowId,
    ownerId: original.ownerId,
    ...(original.workspaceId ? { workspaceId: original.workspaceId } : {}),
    workflowVersionId: original.workflowVersionId,
    versionNumber: original.versionNumber,
    jobId,
    idempotencyKey: `replay-${original._id.toString()}-${randomUUID().slice(0, 8)}`,
    inputHash: original.inputHash,
    input: structuredClone(original.input),
    retryPolicy: policyOf(original),
    maxRetries: original.maxRetries ?? Math.max((options.attempts ?? DEFAULT_EXECUTION_ATTEMPTS) - 1, 0),
    retryCount: 0,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    parentExecutionId: original._id,
    status: 'QUEUING',
    attemptsMade: 0,
    statusHistory: [{ status: 'QUEUING', timestamp: createdAt }],
  });

  return enqueuePersistedExecution(queue, replay, options);
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
    maxRetries: execution.maxRetries ?? 0,
    retryCount: execution.retryCount ?? 0,
    statusHistory,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };

  if (execution.retryPolicy !== undefined) view.retryPolicy = policyOf(execution);
  if (execution.nextRetryAt !== undefined) view.nextRetryAt = execution.nextRetryAt.toISOString();
  if (execution.timeoutMs !== undefined) view.timeoutMs = execution.timeoutMs;
  if (execution.parentExecutionId !== undefined) view.parentExecutionId = execution.parentExecutionId.toString();
  if (execution.result !== undefined) view.result = execution.result;
  if (execution.error !== undefined) view.error = execution.error;
  if (execution.queuedAt !== undefined) view.queuedAt = execution.queuedAt.toISOString();
  if (execution.startedAt !== undefined) view.startedAt = execution.startedAt.toISOString();
  if (execution.finishedAt !== undefined) view.finishedAt = execution.finishedAt.toISOString();
  return view;
}

import { Types } from 'mongoose';
import { ExecutionAnalyticsModel } from '../models/ExecutionAnalyticsModel.js';
import type { AnalyticsExecutionStatus } from '../models/ExecutionAnalyticsModel.js';
import { WorkflowAnalyticsModel } from '../models/WorkflowAnalyticsModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import type { IWorkflowExecution } from '../models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { tenantScope } from './tenantScope.js';
import type {
  AnalyticsRecalculationSummary,
  ExecutionMetricsView,
  ExecutionNodeMetric,
  WorkflowAnalyticsView,
  WorkspaceAnalyticsView,
} from '../types/analytics.js';

export function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function durationBetween(startedAt?: Date | null, finishedAt?: Date | null): number {
  if (!startedAt || !finishedAt) return 0;
  const duration = finishedAt.getTime() - startedAt.getTime();
  return duration > 0 ? duration : 0;
}

export function successRatio(successful: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((successful / total) * 10_000) / 10_000;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 11000;
}

function reportAnalyticsFailure(scope: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : 'unknown error';
  console.error('Could not update ' + scope + ' analytics:', detail);
}

export async function countDefinitionNodes(workflowVersionId?: Types.ObjectId): Promise<number> {
  if (!workflowVersionId) return 0;
  const version = await WorkflowVersionModel.findById(workflowVersionId)
    .select('definition.nodes')
    .lean();
  return version?.definition?.nodes?.length ?? 0;
}

export async function recordWorkflowCreated(workspaceId?: string): Promise<void> {
  if (!workspaceId || !Types.ObjectId.isValid(workspaceId)) return;
  try {
    await WorkspaceUsageModel.updateOne(
      { workspaceId: new Types.ObjectId(workspaceId) },
      {
        $inc: { totalWorkflows: 1 },
        $setOnInsert: { monthKey: monthKeyOf(new Date()) },
      },
      { upsert: true },
    );
  } catch (error) {
    reportAnalyticsFailure('workspace usage', error);
  }
}

export async function recordExecutionReplay(
  workflowId: Types.ObjectId,
  workspaceId?: Types.ObjectId | null,
): Promise<void> {
  try {
    await WorkflowAnalyticsModel.updateOne(
      { workflowId },
      {
        $inc: { replayCount: 1 },
        $setOnInsert: {
          workflowId,
          ...(workspaceId ? { workspaceId } : {}),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    reportAnalyticsFailure('workflow replay', error);
  }
}

export async function recordExecutionOutcome(execution: IWorkflowExecution): Promise<void> {
  const status = execution.status;
  if (status !== 'SUCCEEDED' && status !== 'FAILED') return;

  try {
    const durationMs = durationBetween(execution.startedAt, execution.finishedAt);
    const finishedAt = execution.finishedAt ?? new Date();
    const retryCount = execution.retryCount ?? 0;
    const nodeCount = await countDefinitionNodes(execution.workflowVersionId);

    try {
      await ExecutionAnalyticsModel.create({
        executionId: execution._id,
        workflowId: execution.workflowId,
        ...(execution.workspaceId ? { workspaceId: execution.workspaceId } : {}),
        status,
        durationMs,
        retryCount,
        nodeCount,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) return;
      throw error;
    }

    await applyWorkflowMetrics(execution, status, durationMs, finishedAt);
    await applyWorkspaceMetrics(execution, status, durationMs, finishedAt);
  } catch (error) {
    reportAnalyticsFailure('execution', error);
  }
}

async function applyWorkflowMetrics(
  execution: IWorkflowExecution,
  status: AnalyticsExecutionStatus,
  durationMs: number,
  recordedAt: Date,
): Promise<void> {
  const succeeded = status === 'SUCCEEDED' ? 1 : 0;
  const previousTotal = { $ifNull: ['$totalExecutions', 0] };
  await WorkflowAnalyticsModel.updateOne(
    { workflowId: execution.workflowId },
    [
      {
        $set: {
          workflowId: { $ifNull: ['$workflowId', execution.workflowId] },
          ...(execution.workspaceId
            ? { workspaceId: { $ifNull: ['$workspaceId', execution.workspaceId] } }
            : {}),
          totalExecutions: { $add: [previousTotal, 1] },
          successfulExecutions: { $add: [{ $ifNull: ['$successfulExecutions', 0] }, succeeded] },
          failedExecutions: { $add: [{ $ifNull: ['$failedExecutions', 0] }, succeeded ? 0 : 1] },
          replayCount: { $ifNull: ['$replayCount', 0] },
          averageDurationMs: {
            $cond: [
              { $gt: [previousTotal, 0] },
              {
                $round: [
                  {
                    $divide: [
                      {
                        $add: [
                          { $multiply: [{ $ifNull: ['$averageDurationMs', 0] }, previousTotal] },
                          durationMs,
                        ],
                      },
                      { $add: [previousTotal, 1] },
                    ],
                  },
                  0,
                ],
              },
              durationMs,
            ],
          },
          lastExecutedAt: recordedAt,
          createdAt: { $ifNull: ['$createdAt', recordedAt] },
          updatedAt: recordedAt,
        },
      },
    ],
    { upsert: true, updatePipeline: true },
  );
}

async function applyWorkspaceMetrics(
  execution: IWorkflowExecution,
  status: AnalyticsExecutionStatus,
  durationMs: number,
  recordedAt: Date,
): Promise<void> {
  if (!execution.workspaceId) return;
  const succeeded = status === 'SUCCEEDED' ? 1 : 0;
  const currentMonth = monthKeyOf(recordedAt);
  const previousTotal = { $ifNull: ['$totalExecutions', 0] };
  await WorkspaceUsageModel.updateOne(
    { workspaceId: execution.workspaceId },
    [
      {
        $set: {
          workspaceId: { $ifNull: ['$workspaceId', execution.workspaceId] },
          totalWorkflows: { $ifNull: ['$totalWorkflows', 0] },
          monthKey: currentMonth,
          monthlyExecutions: {
            $cond: [
              { $eq: [{ $ifNull: ['$monthKey', ''] }, currentMonth] },
              { $add: [{ $ifNull: ['$monthlyExecutions', 0] }, 1] },
              1,
            ],
          },
          totalExecutions: { $add: [previousTotal, 1] },
          successfulExecutions: { $add: [{ $ifNull: ['$successfulExecutions', 0] }, succeeded] },
          successRate: {
            $round: [
              {
                $divide: [
                  { $add: [{ $ifNull: ['$successfulExecutions', 0] }, succeeded] },
                  { $add: [previousTotal, 1] },
                ],
              },
              4,
            ],
          },
          averageExecutionTime: {
            $cond: [
              { $gt: [previousTotal, 0] },
              {
                $round: [
                  {
                    $divide: [
                      {
                        $add: [
                          { $multiply: [{ $ifNull: ['$averageExecutionTime', 0] }, previousTotal] },
                          durationMs,
                        ],
                      },
                      { $add: [previousTotal, 1] },
                    ],
                  },
                  0,
                ],
              },
              durationMs,
            ],
          },
          storageUsed: { $ifNull: ['$storageUsed', 0] },
          createdAt: { $ifNull: ['$createdAt', recordedAt] },
          updatedAt: recordedAt,
        },
      },
    ],
    { upsert: true, updatePipeline: true },
  );
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export async function computeWorkspaceStorageBytes(
  workspaceId: Types.ObjectId | string,
): Promise<number> {
  const id = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
  const [workflows, versions, executions] = await Promise.all([
    WorkflowModel.aggregate([
      { $match: { workspaceId: id } },
      { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } },
    ]),
    WorkflowVersionModel.aggregate([
      { $match: { workspaceId: id } },
      { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } },
    ]),
    WorkflowExecutionModel.aggregate([
      { $match: { workspaceId: id } },
      { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } },
    ]),
  ]);
  return (workflows[0]?.bytes ?? 0) + (versions[0]?.bytes ?? 0) + (executions[0]?.bytes ?? 0);
}

async function loadVersionNodeCounts(workspaceId?: Types.ObjectId): Promise<Map<string, number>> {
  const versions = await WorkflowVersionModel
    .find(workspaceId ? { workspaceId } : {})
    .select('definition.nodes')
    .lean();
  return new Map(versions.map(version => [
    version._id.toString(),
    version.definition?.nodes?.length ?? 0,
  ]));
}

async function recomputeWorkspaceUsage(workspaceId: Types.ObjectId): Promise<void> {
  const [totalWorkflows, aggregates] = await Promise.all([
    WorkflowModel.countDocuments({ workspaceId }),
    WorkflowExecutionModel.aggregate([
      { $match: { workspaceId, status: { $in: ['SUCCEEDED', 'FAILED'] } } },
      {
        $group: {
          _id: null,
          totalExecutions: { $sum: 1 },
          successfulExecutions: { $sum: { $cond: [{ $eq: ['$status', 'SUCCEEDED'] }, 1, 0] } },
          averageExecutionTime: { $avg: { $subtract: ['$finishedAt', '$startedAt'] } },
          monthlyExecutions: {
            $sum: { $cond: [{ $gte: ['$finishedAt', startOfMonth(new Date())] }, 1, 0] },
          },
        },
      },
    ]),
  ]);
  const row = aggregates[0];
  const totalExecutions = row?.totalExecutions ?? 0;
  const successfulExecutions = row?.successfulExecutions ?? 0;
  const storageUsed = await computeWorkspaceStorageBytes(workspaceId);
  await WorkspaceUsageModel.updateOne(
    { workspaceId },
    {
      $set: {
        totalWorkflows,
        totalExecutions,
        successfulExecutions,
        monthlyExecutions: row?.monthlyExecutions ?? 0,
        monthKey: monthKeyOf(new Date()),
        successRate: successRatio(successfulExecutions, totalExecutions),
        averageExecutionTime: Math.round(row?.averageExecutionTime ?? 0),
        storageUsed,
      },
    },
    { upsert: true },
  );
}

export async function recalculateAnalytics(
  workspaceId?: string,
): Promise<AnalyticsRecalculationSummary> {
  if (workspaceId !== undefined && !Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  const workspaceObjectId = workspaceId ? new Types.ObjectId(workspaceId) : undefined;
  const terminalMatch: Record<string, unknown> = { status: { $in: ['SUCCEEDED', 'FAILED'] } };
  if (workspaceObjectId) terminalMatch.workspaceId = workspaceObjectId;

  const [executions, versionNodeCounts, replayAggregates] = await Promise.all([
    WorkflowExecutionModel.find(terminalMatch),
    loadVersionNodeCounts(workspaceObjectId),
    WorkflowExecutionModel.aggregate([
      {
        $match: {
          ...(workspaceObjectId ? { workspaceId: workspaceObjectId } : {}),
          parentExecutionId: { $ne: null },
        },
      },
      { $group: { _id: '$workflowId', replayCount: { $sum: 1 } } },
    ]),
  ]);
  const replayCounts = new Map<string, number>(
    replayAggregates.map(row => [row._id.toString(), row.replayCount as number]),
  );

  let executionRows = 0;
  for (const execution of executions) {
    const status: AnalyticsExecutionStatus = execution.status === 'SUCCEEDED'
      ? 'SUCCEEDED'
      : 'FAILED';
    await ExecutionAnalyticsModel.updateOne(
      { executionId: execution._id },
      {
        $set: {
          workflowId: execution.workflowId,
          ...(execution.workspaceId ? { workspaceId: execution.workspaceId } : {}),
          status,
          durationMs: durationBetween(execution.startedAt, execution.finishedAt),
          retryCount: execution.retryCount ?? 0,
          nodeCount: versionNodeCounts.get(execution.workflowVersionId.toString()) ?? 0,
        },
      },
      { upsert: true },
    );
    executionRows += 1;
  }
  return recalculateRollups(workspaceObjectId, replayCounts, executionRows);
}

async function recalculateRollups(
  workspaceObjectId: Types.ObjectId | undefined,
  replayCounts: Map<string, number>,
  executionRows: number,
): Promise<AnalyticsRecalculationSummary> {
  const workflowMatch: Record<string, unknown> = { status: { $in: ['SUCCEEDED', 'FAILED'] } };
  if (workspaceObjectId) workflowMatch.workspaceId = workspaceObjectId;
  const workflows = await WorkflowExecutionModel.aggregate([
    { $match: workflowMatch },
    {
      $group: {
        _id: '$workflowId',
        workspaceId: { $first: '$workspaceId' },
        totalExecutions: { $sum: 1 },
        successfulExecutions: { $sum: { $cond: [{ $eq: ['$status', 'SUCCEEDED'] }, 1, 0] } },
        failedExecutions: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        averageDurationMs: { $avg: { $subtract: ['$finishedAt', '$startedAt'] } },
        lastExecutedAt: { $max: '$finishedAt' },
      },
    },
  ]);

  for (const row of workflows) {
    await WorkflowAnalyticsModel.updateOne(
      { workflowId: row._id },
      {
        $set: {
          workflowId: row._id,
          ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
          totalExecutions: row.totalExecutions,
          successfulExecutions: row.successfulExecutions,
          failedExecutions: row.failedExecutions,
          replayCount: replayCounts.get(row._id.toString()) ?? 0,
          averageDurationMs: Math.round(row.averageDurationMs ?? 0),
          ...(row.lastExecutedAt ? { lastExecutedAt: row.lastExecutedAt } : {}),
        },
      },
      { upsert: true },
    );
  }

  const workspaceIds: unknown[] = workspaceObjectId
    ? [workspaceObjectId]
    : await WorkflowModel.distinct('workspaceId', { workspaceId: { $ne: null } });
  for (const id of workspaceIds) {
    await recomputeWorkspaceUsage(id as Types.ObjectId);
  }

  return {
    workflows: workflows.length,
    executions: executionRows,
    workspaces: workspaceIds.length,
  };
}

export async function getWorkflowAnalytics(
  workflowId: string,
  userId: string,
  workspaceId: string,
): Promise<WorkflowAnalyticsView> {
  if (!Types.ObjectId.isValid(workflowId)) throw new Error('INVALID_WORKFLOW_ID');
  const workflow = await WorkflowModel.findOne({ _id: workflowId, ...tenantScope(userId, workspaceId) });
  if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

  const analytics = await WorkflowAnalyticsModel.findOne({ workflowId: workflow._id }).lean();
  const totalExecutions = analytics?.totalExecutions ?? 0;
  const successfulExecutions = analytics?.successfulExecutions ?? 0;
  const failedExecutions = analytics?.failedExecutions ?? 0;

  const view: WorkflowAnalyticsView = {
    workflowId: workflow._id.toString(),
    totalExecutions,
    successfulExecutions,
    failedExecutions,
    successRate: successRatio(successfulExecutions, totalExecutions),
    failureRate: successRatio(failedExecutions, totalExecutions),
    replayCount: analytics?.replayCount ?? 0,
    averageDurationMs: analytics?.averageDurationMs ?? 0,
  };
  if (workflow.workspaceId) view.workspaceId = workflow.workspaceId.toString();
  if (analytics?.lastExecutedAt) view.lastExecutedAt = analytics.lastExecutedAt.toISOString();
  if (analytics?.updatedAt) view.updatedAt = analytics.updatedAt.toISOString();
  return view;
}

function nodeMetricsOf(execution: IWorkflowExecution): ExecutionNodeMetric[] {
  const stepStatuses = execution.result?.stepStatuses ?? {};
  const history = execution.result?.executionHistory ?? [];
  const firstSeen = new Map<string, number>();
  const lastSeen = new Map<string, number>();

  for (const event of history) {
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time)) continue;
    const first = firstSeen.get(event.nodeId);
    if (first === undefined || time < first) firstSeen.set(event.nodeId, time);
    const last = lastSeen.get(event.nodeId);
    if (last === undefined || time > last) lastSeen.set(event.nodeId, time);
  }

  const nodeIds = [...new Set([...Object.keys(stepStatuses), ...firstSeen.keys()])].sort();
  return nodeIds.map(nodeId => {
    const first = firstSeen.get(nodeId);
    const last = lastSeen.get(nodeId);
    return {
      nodeId,
      status: stepStatuses[nodeId] ?? 'PENDING',
      durationMs: first !== undefined && last !== undefined ? Math.max(last - first, 0) : 0,
    };
  });
}

export async function getExecutionMetrics(
  executionId: string,
  userId: string,
  workspaceId: string,
): Promise<ExecutionMetricsView> {
  if (!Types.ObjectId.isValid(executionId)) throw new Error('INVALID_EXECUTION_ID');
  const execution = await WorkflowExecutionModel.findOne({
    _id: executionId,
    ...tenantScope(userId, workspaceId),
  });
  if (!execution) throw new Error('EXECUTION_NOT_FOUND');

  const nodeCount = await countDefinitionNodes(execution.workflowVersionId);
  const view: ExecutionMetricsView = {
    executionId: execution._id.toString(),
    workflowId: execution.workflowId.toString(),
    status: execution.status,
    retryCount: execution.retryCount ?? 0,
    attemptsMade: execution.attemptsMade,
    nodeCount,
    nodes: nodeMetricsOf(execution),
    createdAt: execution.createdAt.toISOString(),
  };
  if (execution.workspaceId) view.workspaceId = execution.workspaceId.toString();
  if (execution.queuedAt) view.queuedAt = execution.queuedAt.toISOString();
  if (execution.startedAt) view.startedAt = execution.startedAt.toISOString();
  if (execution.finishedAt) {
    view.finishedAt = execution.finishedAt.toISOString();
    view.durationMs = durationBetween(execution.startedAt, execution.finishedAt);
  }
  return view;
}

export async function getWorkspaceAnalytics(workspaceId: string): Promise<WorkspaceAnalyticsView> {
  if (!Types.ObjectId.isValid(workspaceId)) throw new Error('INVALID_WORKSPACE_ID');
  const workspace = await WorkspaceModel.findById(workspaceId).lean();
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const usage = await WorkspaceUsageModel.findOne({ workspaceId: workspace._id }).lean();
  const storageUsed = await computeWorkspaceStorageBytes(workspace._id);

  const view: WorkspaceAnalyticsView = {
    workspaceId: workspace._id.toString(),
    totalWorkflows: usage?.totalWorkflows ?? 0,
    totalExecutions: usage?.totalExecutions ?? 0,
    monthlyExecutions: usage?.monthlyExecutions ?? 0,
    successRate: usage?.successRate ?? 0,
    averageExecutionTime: usage?.averageExecutionTime ?? 0,
    storageUsed,
  };
  if (usage?.updatedAt) view.updatedAt = usage.updatedAt.toISOString();
  return view;
}

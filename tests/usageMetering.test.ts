import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { UsageMeterModel } from '../src/models/UsageMeterModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { AIUsageModel } from '../src/models/AIUsageModel.js';
import { AgentRunModel } from '../src/models/AgentRunModel.js';
import { WorkspaceUsageModel } from '../src/models/WorkspaceUsageModel.js';
import { NotificationModel } from '../src/models/NotificationModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { usageMeteringService, dayPeriodKey, monthPeriodKey } from '../src/services/usageMeteringService.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-usage-metering-tests-5a',
  accessTtl: '15m',
  refreshTtl: '7d',
};

let owner: any;
let ownerToken: string;
let workspaceId: string;
beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  const app = createApp({
    auth: authConfig,
    docs: false,
    health: {
      checks: {
        mongo: async () => ({ status: 'up', latencyMs: 1 }),
        redis: async () => ({ status: 'skipped', latencyMs: 0 }),
        worker: async () => ({ status: 'skipped', latencyMs: 0 }),
      },
    },
  });
  request = supertest(app);

  owner = await UserModel.create({
    email: 'meter-owner@example.test',
    passwordHash: 'unused-test-password-hash',
  });
  ownerToken = signAccessToken(authConfig, { userId: owner._id.toString(), email: owner.email });

  const workspace = await WorkspaceModel.create({
    name: 'Meter Workspace',
    slug: 'meter-workspace',
    ownerId: owner._id,
  });
  workspaceId = workspace._id.toString();
  await WorkspaceMemberModel.create({
    workspaceId: workspace._id,
    userId: owner._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  await SubscriptionModel.create({
    workspaceId: workspace._id,
    plan: 'FREE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: 'cus_meter',
    externalSubscriptionId: 'sub_meter',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
describe('usage metering', () => {
  it('increments day and month buckets and raises an 80% warning alert', async () => {
    const reading = await usageMeteringService.record(workspaceId, 'EXECUTIONS', 850);
    expect(reading.value).toBe(850);
    expect(reading.limit).toBe(1000);
    expect(reading.percent).toBe(85);
    expect(reading.alertState).toBe('WARNING');

    const day = await UsageMeterModel.findOne({
      workspaceId: new Types.ObjectId(workspaceId),
      metric: 'EXECUTIONS',
      granularity: 'DAY',
      periodKey: dayPeriodKey(new Date()),
    });
    expect(day?.value).toBe(850);

    const month = await UsageMeterModel.findOne({
      workspaceId: new Types.ObjectId(workspaceId),
      metric: 'EXECUTIONS',
      granularity: 'MONTH',
      periodKey: monthPeriodKey(new Date()),
    });
    expect(month?.value).toBe(850);
    expect(month?.alertState).toBe('WARNING');

    const audit = await AuditLogModel.findOne({
      action: 'USAGE_QUOTA_ALERT_RAISED',
      workspaceId: new Types.ObjectId(workspaceId),
    });
    expect(audit).toBeTruthy();

    const notification = await NotificationModel.findOne({
      workspaceId: new Types.ObjectId(workspaceId),
      resourceType: 'usage_meter',
    });
    expect(notification).toBeTruthy();
  });

  it('crosses the limit once and deduplicates further alerts', async () => {
    const exceeded = await usageMeteringService.record(workspaceId, 'EXECUTIONS', 150);
    expect(exceeded.value).toBe(1000);
    expect(exceeded.alertState).toBe('EXCEEDED');
    expect(exceeded.overage).toBe(false);

    const over = await usageMeteringService.record(workspaceId, 'EXECUTIONS', 25);
    expect(over.value).toBe(1025);
    expect(over.alertState).toBe('EXCEEDED');
    expect(over.overage).toBe(true);

    const alerts = await AuditLogModel.find({
      action: 'USAGE_QUOTA_ALERT_RAISED',
      workspaceId: new Types.ObjectId(workspaceId),
    });
    expect(alerts).toHaveLength(2);
  });
  it('syncs buckets from real telemetry sources', async () => {
    await WorkflowExecutionModel.create([
      {
        workspaceId: new Types.ObjectId(workspaceId),
        workflowId: new Types.ObjectId(),
        ownerId: owner._id,
        workflowVersionId: new Types.ObjectId(),
        versionNumber: 1,
        jobId: 'meter-job-1',
        idempotencyKey: 'meter-key-1',
        inputHash: 'hash-1',
        input: {},
        status: 'SUCCEEDED',
      },
      {
        workspaceId: new Types.ObjectId(workspaceId),
        workflowId: new Types.ObjectId(),
        ownerId: owner._id,
        workflowVersionId: new Types.ObjectId(),
        versionNumber: 1,
        jobId: 'meter-job-2',
        idempotencyKey: 'meter-key-2',
        inputHash: 'hash-2',
        input: {},
        status: 'FAILED',
      },
      {
        workspaceId: new Types.ObjectId(workspaceId),
        workflowId: new Types.ObjectId(),
        ownerId: owner._id,
        workflowVersionId: new Types.ObjectId(),
        versionNumber: 1,
        jobId: 'meter-job-3',
        idempotencyKey: 'meter-key-3',
        inputHash: 'hash-3',
        input: {},
        status: 'RUNNING',
      },
    ]);

    await AIUsageModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: owner._id,
      feature: 'workflow_generation',
      tokensUsed: 400,
      requests: 1,
      costEstimate: 0,
    });

    await AgentRunModel.create({
      agentId: new Types.ObjectId(),
      workspaceId: new Types.ObjectId(workspaceId),
      requestedBy: owner._id,
      status: 'SUCCEEDED',
    });

    await WorkspaceUsageModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      storageUsed: 2048,
      monthKey: monthPeriodKey(new Date()),
    });

    const readings = await usageMeteringService.syncFromSources(workspaceId);
    const byMetric = new Map(readings.map((reading) => [reading.metric, reading]));
    expect(byMetric.get('EXECUTIONS')?.value).toBe(3);
    expect(byMetric.get('AI_TOKENS')?.value).toBe(400);
    expect(byMetric.get('AGENT_RUNS')?.value).toBe(1);
    expect(byMetric.get('STORAGE_BYTES')?.value).toBe(2048);
  });
  it('joins plan limits in the summary and exposes day series history', async () => {
    const summary = await usageMeteringService.getSummary(workspaceId);
    expect(summary.plan).toBe('FREE');
    expect(summary.metrics).toHaveLength(5);
    const executions = summary.metrics.find((metric) => metric.metric === 'EXECUTIONS');
    expect(executions?.limit).toBe(1000);
    const storage = summary.metrics.find((metric) => metric.metric === 'STORAGE_BYTES');
    expect(storage?.limit).toBe(100 * 1024 * 1024);

    const history = await usageMeteringService.getHistory(workspaceId, 7);
    expect(history.series).toHaveLength(5);
    const executionSeries = history.series.find((series) => series.metric === 'EXECUTIONS');
    expect(executionSeries?.points.length).toBeGreaterThan(0);
    expect(executionSeries?.points[0]?.periodKey).toBe(dayPeriodKey(new Date()));
  });

  it('serves the usage summary and history over HTTP', async () => {
    const summary = await request
      .get('/api/v1/usage')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceId)
      .expect(200);
    expect(summary.body.plan).toBe('FREE');
    expect(summary.body.metrics).toHaveLength(5);

    const history = await request
      .get('/api/v1/usage/history?days=7')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceId)
      .expect(200);
    expect(history.body.days).toBe(7);
    expect(history.body.series).toHaveLength(5);
  });
});

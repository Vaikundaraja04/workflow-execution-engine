import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { TenantAccountModel } from '../src/models/TenantAccountModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { AgentModel } from '../src/models/AgentModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { demoWorkspaceService } from '../src/services/demoWorkspaceService.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-demo-environment-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

let demo: any;
let realWorkspaceId: string;
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

  const realOwner = await UserModel.create({
    email: 'real@customer.test',
    passwordHash: 'unused-test-password-hash',
  });
  const realWorkspace = await WorkspaceModel.create({
    name: 'Real Customer',
    slug: 'real-customer',
    ownerId: realOwner._id,
  });
  realWorkspaceId = realWorkspace._id.toString();
  await WorkspaceMemberModel.create({
    workspaceId: realWorkspace._id,
    userId: realOwner._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
describe('demo sandbox environment', () => {
  it('provisions an isolated demo tenant with starter content', async () => {
    const res = await request.post('/api/v1/demo/create').expect(201);
    demo = res.body;

    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.demoExpiresAt).toBeTruthy();

    const workspace = await WorkspaceModel.findById(res.body.workspaceId);
    expect(workspace?.settings?.demo).toBe(true);
    expect(workspace?.settings?.demoExpiresAt).toBeTruthy();

    const tenant = await TenantAccountModel.findOne({ workspaceId: workspace!._id });
    expect(tenant?.demo).toBe(true);
    expect(tenant?.status).toBe('TRIALING');

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspace!._id });
    expect(subscription?.status).toBe('TRIALING');

    const workflows = await WorkflowModel.find({ workspaceId: workspace!._id });
    expect(workflows).toHaveLength(2);

    const agents = await AgentModel.find({ workspaceId: workspace!._id });
    expect(agents).toHaveLength(1);

    const audit = await AuditLogModel.findOne({ action: 'DEMO_WORKSPACE_CREATED' });
    expect(audit).toBeTruthy();

    const realWorkflows = await WorkflowModel.countDocuments({
      workspaceId: new mongoose.Types.ObjectId(realWorkspaceId),
    });
    expect(realWorkflows).toBe(0);
  });

  it('resets the sandbox for the demo owner and reseeds content', async () => {
    const workspaceId = demo.workspaceId;
    await WorkflowExecutionModel.create({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      workflowId: new mongoose.Types.ObjectId(),
      ownerId: new mongoose.Types.ObjectId(demo.ownerUserId),
      workflowVersionId: new mongoose.Types.ObjectId(),
      versionNumber: 1,
      jobId: 'demo-job-1',
      idempotencyKey: 'demo-key-1',
      inputHash: 'demo-hash-1',
      input: {},
      status: 'SUCCEEDED',
    });

    const res = await request
      .post('/api/v1/demo/reset')
      .set(authHeader(demo.tokens.accessToken))
      .set('x-workspace-id', workspaceId)
      .send({})
      .expect(200);

    expect(res.body.workflows).toHaveLength(2);
    expect(res.body.agents).toHaveLength(1);

    const executions = await WorkflowExecutionModel.countDocuments({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    });
    expect(executions).toBe(0);

    const audit = await AuditLogModel.findOne({ action: 'DEMO_WORKSPACE_RESET' });
    expect(audit).toBeTruthy();
  });
  it('rejects reset attempts from users who are neither owner nor platform admin', async () => {
    const intruder = await UserModel.create({
      email: 'intruder@other.test',
      passwordHash: 'unused-test-password-hash',
    });
    const intruderToken = signAccessToken(authConfig, {
      userId: intruder._id.toString(),
      email: intruder.email,
    });

    await request
      .post('/api/v1/demo/reset')
      .set(authHeader(intruderToken))
      .send({ workspaceId: demo.workspaceId })
      .expect(403);
  });

  it('expires stale sandboxes and closes the tenant', async () => {
    await WorkspaceModel.updateOne(
      { _id: new mongoose.Types.ObjectId(demo.workspaceId) },
      { $set: { 'settings.demoExpiresAt': new Date(Date.now() - 60_000) } },
    );

    const result = await demoWorkspaceService.expireStale();
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const workspace = await WorkspaceModel.findById(demo.workspaceId);
    expect(workspace?.status).toBe('DELETED');

    const tenant = await TenantAccountModel.findOne({
      workspaceId: new mongoose.Types.ObjectId(demo.workspaceId),
    });
    expect(tenant?.status).toBe('CLOSED');

    const workflows = await WorkflowModel.countDocuments({
      workspaceId: new mongoose.Types.ObjectId(demo.workspaceId),
    });
    expect(workflows).toBe(0);
  });
});

describe('demo sandbox expiry scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    demoWorkspaceService.stopScheduler();
    delete process.env.DEMO_RESET_INTERVAL_MS;
  });

  it('refuses to start below the minimum expiry interval', () => {
    delete process.env.DEMO_RESET_INTERVAL_MS;
    expect(demoWorkspaceService.startScheduler()).toEqual({ started: false, intervalMs: null });

    process.env.DEMO_RESET_INTERVAL_MS = '59999';
    expect(demoWorkspaceService.startScheduler()).toEqual({ started: false, intervalMs: null });

    process.env.DEMO_RESET_INTERVAL_MS = 'soon';
    expect(demoWorkspaceService.startScheduler()).toEqual({ started: false, intervalMs: null });
  });
  it('expires stale sandboxes on the configured interval, starts only once and stops cleanly', async () => {
    vi.useFakeTimers();
    process.env.DEMO_RESET_INTERVAL_MS = '90000';
    const expireStale = vi.spyOn(demoWorkspaceService, 'expireStale').mockResolvedValue({ expired: 0 });

    expect(demoWorkspaceService.startScheduler()).toEqual({ started: true, intervalMs: 90000 });
    expect(demoWorkspaceService.startScheduler()).toEqual({ started: false, intervalMs: 90000 });

    await vi.advanceTimersByTimeAsync(90000);
    expect(expireStale).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(180000);
    expect(expireStale).toHaveBeenCalledTimes(3);

    demoWorkspaceService.stopScheduler();
    await vi.advanceTimersByTimeAsync(270000);
    expect(expireStale).toHaveBeenCalledTimes(3);

    expect(demoWorkspaceService.startScheduler()).toEqual({ started: true, intervalMs: 90000 });
  });
  it('keeps the scheduler alive when an expiry sweep fails', async () => {
    vi.useFakeTimers();
    process.env.DEMO_RESET_INTERVAL_MS = '90000';
    const expireStale = vi.spyOn(demoWorkspaceService, 'expireStale').mockRejectedValue(new Error('expiry failed'));

    demoWorkspaceService.startScheduler();
    await vi.advanceTimersByTimeAsync(180000);
    expect(expireStale).toHaveBeenCalledTimes(2);
  });
});

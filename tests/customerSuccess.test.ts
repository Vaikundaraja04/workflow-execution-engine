import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { categoryForScore } from '../src/services/customerSuccessService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-customer-success',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'cs-admin@acme.test';
const memberEmail = 'cs-member@acme.test';
let adminToken = '';
let memberToken = '';
let workspaceId = '';
let memberWorkspaceId = '';
let adminUserId = '';

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
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

  const admin = await request.post('/api/v1/saas/signup').send({
    email: adminEmail,
    password: 'SuccessPass123!',
    name: 'CS Admin',
    companyName: 'CS Test Co',
  });
  adminToken = admin.body.tokens.accessToken;
  workspaceId = admin.body.workspace.id;
  adminUserId = admin.body.user.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: memberEmail,
    password: 'MemberPass123!',
    name: 'CS Member',
    companyName: 'Member Test Co',
  });
  memberToken = member.body.tokens.accessToken;
  memberWorkspaceId = member.body.workspace.id;

  await WorkspaceMemberModel.updateMany({ status: 'ACTIVE' }, { $set: { lastActiveAt: new Date() } });
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authed = (req: supertest.Test) => req.set('Authorization', `Bearer ${adminToken}`);

describe('Phase 16.4 customer success platform', () => {
  it('reports one workspace with adoption, operations and category', async () => {
    const res = await authed(request.get(`/api/v1/customers/${workspaceId}/health`)).expect(200);
    expect(res.body.workspaceId).toBe(workspaceId);
    expect(res.body.category).toBe(categoryForScore(res.body.score));
    expect(['Healthy', 'At Risk', 'Critical']).toContain(res.body.category);
    expect(res.body.adoption.features).toHaveLength(5);
    expect(res.body.adoption.totalMembers).toBeGreaterThanOrEqual(1);
    expect(res.body.adoption.activeUsers).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.generatedAt).toBeTruthy();
  });

  it('counts failed execution pressure on the workspace', async () => {
    await WorkflowExecutionModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      workflowId: new Types.ObjectId(),
      ownerId: new Types.ObjectId(adminUserId),
      workflowVersionId: new Types.ObjectId(),
      versionNumber: 1,
      jobId: 'cs-fail-1',
      idempotencyKey: 'cs-fail-1',
      inputHash: 'cs-hash-1',
      input: {},
      status: 'FAILED',
    });
    const res = await authed(request.get(`/api/v1/customers/${workspaceId}/health`)).expect(200);
    expect(res.body.operations.failedExecutions30d).toBeGreaterThanOrEqual(1);
    expect(res.body.operations.failureRatePercent).toBeGreaterThan(0);
    expect(res.body.operations.topFailingWorkflows[0].failures).toBeGreaterThanOrEqual(1);
    expect(res.body.operations.topFailingWorkflows[0].name).toBeTruthy();
  });

  it('returns the cross-tenant portfolio to platform administrators', async () => {
    const res = await authed(request.get('/api/v1/customers/health')).expect(200);
    expect(res.body.customers.length).toBeGreaterThanOrEqual(2);
    expect(res.body.summary.total).toBe(res.body.customers.length);
    expect(res.body.summary.healthy + res.body.summary.atRisk + res.body.summary.critical).toBe(res.body.summary.total);
    expect(res.body.customers.some((customer: { workspaceId: string }) => customer.workspaceId === workspaceId)).toBe(true);

    const healthy = await authed(request.get('/api/v1/customers/health?category=Healthy')).expect(200);
    expect(healthy.body.customers.every((customer: { category: string }) => customer.category === 'Healthy')).toBe(true);
    await authed(request.get('/api/v1/customers/health?category=Nope')).expect(400);
  });

  it('lets members read only their own tenant', async () => {
    const own = await request.get(`/api/v1/customers/${memberWorkspaceId}/health`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    expect(own.body.workspaceId).toBe(memberWorkspaceId);

    const cross = await request.get(`/api/v1/customers/${workspaceId}/health`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(404);
    expect(cross.body.error.code).toBe('WORKSPACE_NOT_FOUND');

    await request.get(`/api/v1/customers/${workspaceId}/health`).expect(401);
    await request.get('/api/v1/customers/health').set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('rejects invalid workspace ids', async () => {
    const res = await authed(request.get('/api/v1/customers/not-an-id/health')).expect(400);
    expect(res.body.error.code).toBe('INVALID_WORKSPACE_ID');
  });
});

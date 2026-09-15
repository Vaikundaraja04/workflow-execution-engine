import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { PlanModel, ensureDefaultPlans } from '../src/models/PlanModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-subscription-tests-5a',
  accessTtl: '15m',
  refreshTtl: '7d',
};

// Test users and tokens
let ownerUser: any;
let ownerToken: string;

let workspaceA: any;
let workspaceAId: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  await ensureDefaultPlans();

  const app = createApp({
    auth: authConfig,
    docs: true,
    health: {
      checks: {
        mongo: async () => ({ status: 'up', latencyMs: 1 }),
        redis: async () => ({ status: 'skipped', latencyMs: 0 }),
        worker: async () => ({ status: 'skipped', latencyMs: 0 }),
      },
    },
  });

  request = supertest(app);

  // Create owner user
  ownerUser = await UserModel.create({
    email: 'owner@example.com',
    passwordHash: await hashPassword('OwnerPass123!'),
  });

  ownerToken = signAccessToken(authConfig, { userId: ownerUser._id.toString(), email: ownerUser.email });

  // Create workspace A
  workspaceA = await WorkspaceModel.create({
    name: 'Workspace A',
    slug: 'workspace-a',
    description: 'Test workspace A',
    ownerId: ownerUser._id,
  });

  workspaceAId = workspaceA._id.toString();

  // Set default workspace on ownerUser
  ownerUser.defaultWorkspaceId = workspaceA._id;
  await ownerUser.save();

  // Make owner a member of workspace A
  await WorkspaceMemberModel.create({
    workspaceId: workspaceA._id,
    userId: ownerUser._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });

  // Create a default subscription for workspace A (FREE plan)
  await SubscriptionModel.create({
    workspaceId: workspaceA._id,
    plan: 'FREE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: 'cus_test_123',
    externalSubscriptionId: 'sub_test_123',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

describe('Subscription API', () => {
  it('should get current subscription', async () => {
    const res = await request
      .get('/api/v1/subscription')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('plan', 'FREE');
    expect(res.body).toHaveProperty('status', 'ACTIVE');
    expect(res.body).toHaveProperty('planDetails');
    expect(res.body.planDetails?.id).toBe('FREE');
  });

  it('should upgrade subscription to STARTER', async () => {
    const res = await request
      .post('/api/v1/subscription/upgrade')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plan: 'STARTER' })
      .expect(200);

    expect(res.body).toHaveProperty('message', 'Subscription updated successfully');
    expect(res.body.subscription.plan).toBe('STARTER');
    expect(res.body.subscription.status).toBe('ACTIVE');
  });

  it('should downgrade subscription to FREE', async () => {
    // First upgrade to PROFESSIONAL
    await request
      .post('/api/v1/subscription/upgrade')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plan: 'PROFESSIONAL' })
      .expect(200);

    // Then downgrade to FREE
    const res = await request
      .post('/api/v1/subscription/upgrade')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plan: 'FREE' })
      .expect(200);

    expect(res.body).toHaveProperty('message', 'Subscription updated successfully');
    expect(res.body.subscription.plan).toBe('FREE');
    expect(res.body.subscription.status).toBe('ACTIVE');
  });

  it('should cancel subscription', async () => {
    const res = await request
      .post('/api/v1/subscription/cancel')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('message', 'Subscription cancelled successfully');
    expect(res.body.subscription.status).toBe('CANCELLED');
  });

  it('should get all plans', async () => {
    const res = await request
      .get('/api/v1/subscription/plans')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(Array.isArray(res.body.plans)).toBe(true);
    expect(res.body.plans.length).toBe(4);
    expect(res.body.plans.some((p: any) => p.id === 'FREE')).toBe(true);
    expect(res.body.plans.some((p: any) => p.id === 'STARTER')).toBe(true);
    expect(res.body.plans.some((p: any) => p.id === 'PROFESSIONAL')).toBe(true);
    expect(res.body.plans.some((p: any) => p.id === 'ENTERPRISE')).toBe(true);
  });

  it('should return 404 when trying to access subscription without workspace membership', async () => {
    // Create a second user who is not a member of workspace A
    const otherUser = await UserModel.create({
      email: 'other@example.com',
      passwordHash: await hashPassword('OtherPass123!'),
    });
    const otherToken = signAccessToken(authConfig, { userId: otherUser._id.toString(), email: otherUser.email });

    const res = await request
      .get('/api/v1/subscription')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(404);

    expect(res.body.error.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('should return 403 when a member without permissions tries to upgrade subscription', async () => {
    // Create a viewer user in workspace A
    const viewerUser = await UserModel.create({
      email: 'viewer@example.com',
      passwordHash: await hashPassword('ViewerPass123!'),
    });
    const viewerToken = signAccessToken(authConfig, { userId: viewerUser._id.toString(), email: viewerUser.email });

    await WorkspaceMemberModel.create({
      workspaceId: workspaceA._id,
      userId: viewerUser._id,
      role: 'VIEWER',
      status: 'ACTIVE',
    });

    const res = await request
      .post('/api/v1/subscription/upgrade')
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({ plan: 'ENTERPRISE' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

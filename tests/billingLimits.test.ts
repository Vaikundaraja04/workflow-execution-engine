import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { WebhookModel } from '../src/models/WebhookModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { validateWorkspaceQuota } from '../src/services/planService.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-billing-limits-tests-5a',
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

  ownerUser.defaultWorkspaceId = workspaceA._id;
  await ownerUser.save();

  // Make owner a member of workspace A
  await WorkspaceMemberModel.create({
    workspaceId: workspaceA._id,
    userId: ownerUser._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });

  // Create a FREE subscription for workspace A
  await SubscriptionModel.create({
    workspaceId: workspaceA._id,
    plan: 'FREE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: 'cus_test_123',
    externalSubscriptionId: 'sub_test_123',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

describe('Billing Limits Enforcement', () => {
  const validDefinition = {
    nodes: [{ id: 'node_1', type: 'log', config: { message: 'hello' } }],
    edges: [],
  };

  it('should allow creating workflows within FREE plan limit', async () => {
    // FREE plan allows 10 workflows
    // Create 9 workflows (should succeed)
    for (let i = 0; i < 9; i++) {
      const res = await request
        .post('/api/workflows')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: `Workflow ${i}`,
          definition: validDefinition,
          workspaceId: workspaceAId,
        })
        .expect(201);
    }

    // The 10th workflow should also succeed (at limit)
    const res = await request
      .post('/api/workflows')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Workflow 10',
        definition: validDefinition,
        workspaceId: workspaceAId,
      })
      .expect(201);

    expect(res.body).toHaveProperty('_id');
  });

  it('should block creating workflows beyond FREE plan limit', async () => {
    // We already have 10 workflows from the previous test
    // The 11th workflow should fail
    const res = await request
      .post('/api/workflows')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Workflow 11 (should fail)',
        definition: validDefinition,
        workspaceId: workspaceAId,
      })
      .expect(403);

    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.error.resource).toBe('workflows');
  });

  it('should allow creating API keys within FREE plan limit', async () => {
    // FREE plan allows 2 API keys
    // Create 2 API keys (should succeed)
    const apiKey1Res = await request
      .post('/api/v1/keys')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        name: 'Test Key 1',
        permissions: ['WORKFLOW_READ'],
      })
      .expect(201);

    const apiKey2Res = await request
      .post('/api/v1/keys')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        name: 'Test Key 2',
        permissions: ['WORKFLOW_READ'],
      })
      .expect(201);

    // Both should succeed
    expect(apiKey1Res.body.key.keyPrefix).toBeDefined();
    expect(apiKey2Res.body.key.keyPrefix).toBeDefined();
  });

  it('should block creating API keys beyond FREE plan limit', async () => {
    // We already have 2 API keys from above
    // The 3rd API key should fail
    const res = await request
      .post('/api/v1/keys')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        name: 'Test Key 3 (should fail)',
        permissions: ['WORKFLOW_READ'],
      })
      .expect(403);

    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.error.resource).toBe('apiKeys');
  });

  it('should allow creating webhooks within FREE plan limit', async () => {
    // FREE plan allows 2 webhooks
    const webhook1Res = await request
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        name: 'Test Webhook 1',
        url: 'https://example.com/webhook1',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
      })
      .expect(201);

    const webhook2Res = await request
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        name: 'Test Webhook 2',
        url: 'https://example.com/webhook2',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
      })
      .expect(201);

    // Both should succeed
    expect(webhook1Res.body).toHaveProperty('id');
    expect(webhook2Res.body).toHaveProperty('id');
  });

  it('should block creating webhooks beyond FREE plan limit', async () => {
    // We already have 2 webhooks from above
    // The 3rd webhook should fail
    const res = await request
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        name: 'Test Webhook 3 (should fail)',
        url: 'https://example.com/webhook3',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
      })
      .expect(403);

    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.error.resource).toBe('webhooks');
  });

  it('should allow inviting members within FREE plan limit', async () => {
    // FREE plan allows 3 members (including owner)
    // We already have 1 member (the owner)
    // So we can invite 2 more members

    // Create two additional users
    const user1 = await UserModel.create({
      email: 'user1@example.com',
      passwordHash: await hashPassword('User1Pass123!'),
    });
    const user2 = await UserModel.create({
      email: 'user2@example.com',
      passwordHash: await hashPassword('User2Pass123!'),
    });

    // Invite user1 as VIEWER
    const invite1Res = await request
      .post(`/api/workspaces/${workspaceAId}/members/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: user1.email,
        role: 'VIEWER',
      })
      .expect(201);

    // Invite user2 as VIEWER
    const invite2Res = await request
      .post(`/api/workspaces/${workspaceAId}/members/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: user2.email,
        role: 'VIEWER',
      })
      .expect(201);

    // Both invites should succeed
    expect(invite1Res.body).toHaveProperty('id');
    expect(invite2Res.body).toHaveProperty('id');

    // Now accept the invitations (simulate by updating status)
    await WorkspaceMemberModel.updateMany(
      { workspaceId: workspaceA._id, userId: { $in: [user1._id, user2._id] } },
      { $set: { status: 'ACTIVE' } }
    );
  });

  it('should block inviting members beyond FREE plan limit', async () => {
    // We now have 3 members total (owner + 2 invited)
    // The 4th member invitation should fail

    const user3 = await UserModel.create({
      email: 'user3@example.com',
      passwordHash: await hashPassword('User3Pass123!'),
    });

    const res = await request
      .post(`/api/workspaces/${workspaceAId}/members/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: user3.email,
        role: 'VIEWER',
      })
      .expect(403);

    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.error.resource).toBe('members');
  });
});

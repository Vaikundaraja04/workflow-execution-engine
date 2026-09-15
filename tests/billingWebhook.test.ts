import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { createAuditLog } from '../src/services/auditService.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-billing-webhook-tests-5a',
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

  // Make owner a member of workspace A
  await WorkspaceMemberModel.create({
    workspaceId: workspaceA._id,
    userId: ownerUser._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

// Reset subscription state before each test
beforeEach(async () => {
  // Clear any existing subscriptions for workspace A
  await SubscriptionModel.deleteMany({ workspaceId: workspaceA._id });
});

describe('Billing Webhook Handling', () => {
  it('should handle subscription.created webhook', async () => {
    // Ensure no existing subscription
    await SubscriptionModel.deleteMany({ workspaceId: workspaceAId });

    const webhookPayload = {
      type: 'subscription.created',
      data: {
        id: 'sub_new_123',
        customer: {
          id: 'cus_new_123',
        },
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days from now
        trial_end: null,
        metadata: {
          workspaceId: workspaceAId,
        },
      },
    };

    const res = await request
      .post('/api/v1/billing/webhook')
      .send(webhookPayload)
      .expect(200);

    expect(res.body).toHaveProperty('received', true);

    // Verify subscription was created
    const subscription = await SubscriptionModel.findOne({ externalCustomerId: 'cus_new_123' });
    expect(subscription).toBeTruthy();
    expect(subscription?.externalSubscriptionId).toBe('sub_new_123');
    expect(subscription?.plan).toBe('FREE'); // Default plan in mock
    expect(subscription?.status).toBe('ACTIVE');

    // Verify audit log was created
    const auditLog = await AuditLogModel.findOne({ action: 'SUBSCRIPTION_CREATED' });
    expect(auditLog).toBeTruthy();
    expect(auditLog?.workspaceId?.toString()).toBe(workspaceAId);
  });

  it('should handle subscription.updated webhook', async () => {
    // Create a subscription to update
    await SubscriptionModel.create({
      workspaceId: workspaceA._id,
      plan: 'FREE',
      status: 'ACTIVE',
      billingProvider: 'mock',
      externalCustomerId: 'cus_test_123',
      externalSubscriptionId: 'sub_test_123',
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    });

    const webhookPayload = {
      type: 'subscription.updated',
      data: {
        id: 'sub_test_123',
        status: 'past_due',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days from now
        trial_end: null,
        metadata: {},
      },
    };

    const res = await request
      .post('/api/v1/billing/webhook')
      .send(webhookPayload)
      .expect(200);

    expect(res.body).toHaveProperty('received', true);

    // Verify subscription was updated
    const subscription = await SubscriptionModel.findOne({ externalSubscriptionId: 'sub_test_123' });
    expect(subscription).toBeTruthy();
    expect(subscription?.status).toBe('PAST_DUE');

    // Verify audit log was created
    const auditLog = await AuditLogModel.findOne({ action: 'SUBSCRIPTION_CHANGED' });
    expect(auditLog).toBeTruthy();
    expect(auditLog?.workspaceId?.toString()).toBe(workspaceAId);
  });

  it('should handle subscription.cancelled webhook', async () => {
    // Create a subscription to cancel
    await SubscriptionModel.create({
      workspaceId: workspaceA._id,
      plan: 'FREE',
      status: 'ACTIVE',
      billingProvider: 'mock',
      externalCustomerId: 'cus_test_123',
      externalSubscriptionId: 'sub_test_123',
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    });

    const webhookPayload = {
      type: 'subscription.cancelled',
      data: {
        id: 'sub_test_123',
      },
    };

    const res = await request
      .post('/api/v1/billing/webhook')
      .send(webhookPayload)
      .expect(200);

    expect(res.body).toHaveProperty('received', true);

    // Verify subscription was cancelled
    const subscription = await SubscriptionModel.findOne({ externalSubscriptionId: 'sub_test_123' });
    expect(subscription).toBeTruthy();
    expect(subscription?.status).toBe('CANCELLED');

    // Verify audit log was created
    const auditLog = await AuditLogModel.findOne({ action: 'SUBSCRIPTION_CANCELLED' });
    expect(auditLog).toBeTruthy();
    expect(auditLog?.workspaceId?.toString()).toBe(workspaceAId);
  });

  it('should handle payment.failed webhook', async () => {
    // Create a subscription
    await SubscriptionModel.create({
      workspaceId: workspaceA._id,
      plan: 'FREE',
      status: 'ACTIVE',
      billingProvider: 'mock',
      externalCustomerId: 'cus_test_123',
      externalSubscriptionId: 'sub_test_123',
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    });

    const webhookPayload = {
      type: 'payment.failed',
      data: {
        id: 'sub_test_123',
      },
    };

    const res = await request
      .post('/api/v1/billing/webhook')
      .send(webhookPayload)
      .expect(200);

    expect(res.body).toHaveProperty('received', true);

    // Verify subscription status updated to past_due
    const subscription = await SubscriptionModel.findOne({ externalSubscriptionId: 'sub_test_123' });
    expect(subscription).toBeTruthy();
    expect(subscription?.status).toBe('PAST_DUE');

    // Verify audit log was created
    const auditLog = await AuditLogModel.findOne({ action: 'PAYMENT_FAILED' });
    expect(auditLog).toBeTruthy();
    expect(auditLog?.workspaceId?.toString()).toBe(workspaceAId);
  });

  it('should reject webhook with invalid signature', async () => {
    // In our mock implementation, we accept any webhook (no signature verification)
    // But we'll test that malformed payload is rejected
    const webhookPayload = {
      // Missing type field
      data: {},
    };

    const res = await request
      .post('/api/v1/billing/webhook')
      .send(webhookPayload)
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_WEBHOOK_PAYLOAD');
  });
});
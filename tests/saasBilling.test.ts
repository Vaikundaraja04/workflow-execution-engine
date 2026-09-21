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
import { TenantAccountModel } from '../src/models/TenantAccountModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { MockBillingProvider } from '../src/services/billing/mockBillingProvider.js';
import { createBillingProvider } from '../src/services/billing/billingProviderRegistry.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-saas-billing-tests-5a',
  accessTtl: '15m',
  refreshTtl: '7d',
};

let ownerToken: string;
let workspaceAId: string;
let workspaceBId: string;

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
  const owner = await UserModel.create({
    email: 'billing-owner@example.test',
    passwordHash: 'unused-test-password-hash',
  });
  ownerToken = signAccessToken(authConfig, { userId: owner._id.toString(), email: owner.email });

  const workspaceA = await WorkspaceModel.create({
    name: 'Billing Workspace A',
    slug: 'billing-workspace-a',
    ownerId: owner._id,
  });
  workspaceAId = workspaceA._id.toString();
  await WorkspaceMemberModel.create({
    workspaceId: workspaceA._id,
    userId: owner._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  await SubscriptionModel.create({
    workspaceId: workspaceA._id,
    plan: 'FREE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: 'cus_billing_a',
    externalSubscriptionId: 'sub_billing_a',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  await TenantAccountModel.create({
    workspaceId: workspaceA._id,
    ownerUserId: owner._id,
    companyName: 'Billing Workspace A',
    status: 'ACTIVE',
    plan: 'FREE',
  });

  const workspaceB = await WorkspaceModel.create({
    name: 'Billing Workspace B',
    slug: 'billing-workspace-b',
    ownerId: owner._id,
  });
  workspaceBId = workspaceB._id.toString();
  await WorkspaceMemberModel.create({
    workspaceId: workspaceB._id,
    userId: owner._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  await SubscriptionModel.create({
    workspaceId: workspaceB._id,
    plan: 'ENTERPRISE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: 'cus_billing_b',
    externalSubscriptionId: 'sub_billing_b',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
describe('SaaS billing additions', () => {
  it('serves the pricing catalog with the BUSINESS alias', async () => {
    const res = await request.get('/api/v1/billing/plans').expect(200);
    expect(res.body.plans).toHaveLength(4);
    expect(res.body.aliases.BUSINESS).toBe('PROFESSIONAL');
    expect(res.body.plans.map((plan: any) => plan.id)).toEqual([
      'FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE',
    ]);
  });

  it('starts a trial through the provider and rejects a second trial', async () => {
    const res = await request
      .post('/api/v1/billing/trial')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceAId)
      .send({ days: 7 })
      .expect(200);

    expect(res.body.subscription.status).toBe('TRIALING');
    expect(res.body.subscription.trialEndsAt).toBeTruthy();

    const subscription = await SubscriptionModel.findOne({
      workspaceId: new Types.ObjectId(workspaceAId),
    });
    expect(subscription?.status).toBe('TRIALING');

    const audit = await AuditLogModel.findOne({
      action: 'SUBSCRIPTION_TRIAL_STARTED',
      workspaceId: new Types.ObjectId(workspaceAId),
    });
    expect(audit).toBeTruthy();

    await request
      .post('/api/v1/billing/trial')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceAId)
      .send({ days: 7 })
      .expect(409);
  });
  it('captures the previous plan when changing plans and syncs the tenant account', async () => {
    const res = await request
      .post('/api/v1/billing/upgrade')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceAId)
      .send({ plan: 'PROFESSIONAL' })
      .expect(200);

    expect(res.body.subscription.plan).toBe('PROFESSIONAL');

    const audit = await AuditLogModel.findOne({
      action: 'SUBSCRIPTION_CHANGED',
      workspaceId: new Types.ObjectId(workspaceAId),
    });
    expect(audit?.metadata?.previousPlan).toBe('FREE');
    expect(audit?.metadata?.newPlan).toBe('PROFESSIONAL');

    const tenant = await TenantAccountModel.findOne({
      workspaceId: new Types.ObjectId(workspaceAId),
    });
    expect(tenant?.plan).toBe('PROFESSIONAL');
  });

  it('answers entitlement checks from the plan features', async () => {
    const entitled = await request
      .post('/api/v1/billing/check-feature')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceBId)
      .send({ feature: 'Dedicated support & SLAs' })
      .expect(200);
    expect(entitled.body.entitled).toBe(true);

    const notEntitled = await request
      .post('/api/v1/billing/check-feature')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceBId)
      .send({ feature: 'Priority support' })
      .expect(200);
    expect(notEntitled.body.entitled).toBe(false);
  });

  it('lists deterministic mock provider invoices', async () => {
    const res = await request
      .get('/api/v1/billing/invoices?limit=3')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceBId)
      .expect(200);

    expect(res.body.invoices).toHaveLength(3);
    expect(res.body.invoices[0].id).toContain('in_mock_');
    expect(res.body.invoices[0].status).toBe('paid');
  });

  it('cancels the subscription', async () => {
    const res = await request
      .post('/api/v1/billing/cancel')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceAId)
      .send({ immediate: true })
      .expect(200);
    expect(res.body.subscription.status).toBe('CANCELLED');
  });
});
describe('billing provider registry', () => {
  it('resolves the mock provider and fails fast for unknown or unconfigured providers', () => {
    expect(createBillingProvider('mock')).toBeInstanceOf(MockBillingProvider);
    expect(() => createBillingProvider('nope')).toThrow('INVALID_BILLING_PROVIDER');

    const previousStripeKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      expect(() => createBillingProvider('stripe')).toThrow('BILLING_PROVIDER_NOT_CONFIGURED');
    } finally {
      if (previousStripeKey !== undefined) process.env.STRIPE_SECRET_KEY = previousStripeKey;
    }

    const previousRazorpayKey = process.env.RAZORPAY_KEY_ID;
    const previousRazorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      expect(() => createBillingProvider('razorpay')).toThrow('BILLING_PROVIDER_NOT_CONFIGURED');
    } finally {
      if (previousRazorpayKey !== undefined) process.env.RAZORPAY_KEY_ID = previousRazorpayKey;
      if (previousRazorpaySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = previousRazorpaySecret;
    }
  });
});

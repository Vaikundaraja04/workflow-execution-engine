import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { PaymentRecordModel } from '../src/models/PaymentRecordModel.js';
import { TenantAccountModel } from '../src/models/TenantAccountModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { ConversionEventModel } from '../src/models/ConversionEventModel.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 15.3 - Checkout to activation flow.
 *
 * Plan selection -> session -> verification -> activation -> entitlement change,
 * including the unpaid path that must leave the subscription untouched.
 */

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-billing-flow-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const ownerEmail = 'billing-flow@acme.test';
let ownerToken = '';
let workspaceId = '';

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

  const signup = await request.post('/api/v1/saas/signup').send({
    email: ownerEmail,
    password: 'FounderPass123!',
    name: 'Billing Owner',
    companyName: 'Billing Flow Co',
  });
  ownerToken = signup.body.tokens.accessToken;
  workspaceId = signup.body.workspace.id;
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const scoped = (req: supertest.Test) =>
  req.set('Authorization', `Bearer ${ownerToken}`).set('X-Workspace-Id', workspaceId);

describe('Phase 15.3 checkout flow', () => {
  it('starts with no subscription on a sellable package', async () => {
    const subscription = await SubscriptionModel.findOne({ workspaceId });
    expect(subscription?.plan).toBe('FREE');
    const account = await TenantAccountModel.findOne({ workspaceId }).lean();
    expect(account?.plan).toBe('FREE');
  });

  it('creates a checkout session priced from the packaged catalog', async () => {
    const response = await scoped(request.post('/api/v1/billing/checkout')).send({
      packageId: 'BUSINESS',
    });
    expect(response.status).toBe(201);
    const session = response.body.session;
    expect(session.packageId).toBe('BUSINESS');
    expect(session.plan).toBe('PROFESSIONAL');
    expect(session.amount).toBe(9900);
    expect(session.currency).toBe('usd');
    expect(session.provider).toBe('mock');
    expect(session.rails).toContain('card');
    expect(session.clientSecret).toBeTruthy();

    const audit = await AuditLogModel.findOne({ action: 'CHECKOUT_STARTED', workspaceId });
    expect(audit).not.toBeNull();
    expect(audit?.metadata?.packageId).toBe('BUSINESS');
  });

  it('leaves the subscription untouched while the payment is unsettled', async () => {
    const session = await scoped(request.post('/api/v1/billing/checkout')).send({
      packageId: 'BUSINESS',
    });
    const paymentId = session.body.session.id;

    const verification = await scoped(request.post('/api/v1/billing/checkout/verify')).send({
      paymentId,
      packageId: 'BUSINESS',
    });
    expect(verification.status).toBe(200);
    expect(verification.body.activated).toBe(false);
    expect(verification.body.reason).toBe('PAYMENT_NOT_SETTLED');
    expect(verification.body.payment.paid).toBe(false);
    expect(verification.body.subscription.plan).toBe('FREE');

    const subscription = await SubscriptionModel.findOne({ workspaceId }).lean();
    expect(subscription?.plan).toBe('FREE');
    const record = await PaymentRecordModel.findOne({ paymentId, workspaceId }).lean();
    expect(record?.paid).toBe(false);
    expect(record?.activated).toBe(false);
    expect(await AuditLogModel.countDocuments({ action: 'CHECKOUT_COMPLETED', workspaceId })).toBe(0);
  });
  it('activates the package once the payment settled and refreshes entitlements', async () => {
    // The mock provider adopts unknown identifiers as settled payments.
    const verification = await scoped(request.post('/api/v1/billing/checkout/verify')).send({
      paymentId: 'pi_paid_billing_flow_1',
      packageId: 'BUSINESS',
    });
    expect(verification.status).toBe(200);
    expect(verification.body.activated).toBe(true);
    expect(verification.body.reason).toBe('ACTIVATED');
    expect(verification.body.subscription.plan).toBe('PROFESSIONAL');
    expect(verification.body.subscription.status).toBe('ACTIVE');

    const entitlements = verification.body.entitlements;
    expect(entitlements.plan).toBe('PROFESSIONAL');
    expect(entitlements.packageId).toBe('BUSINESS');
    const agents = entitlements.features.find((entry: { feature: string }) => entry.feature === 'AI_AGENTS');
    expect(agents?.entitled).toBe(true);

    const subscription = await SubscriptionModel.findOne({ workspaceId }).lean();
    expect(subscription?.plan).toBe('PROFESSIONAL');
    expect(subscription?.status).toBe('ACTIVE');
    const account = await TenantAccountModel.findOne({ workspaceId }).lean();
    expect(account?.plan).toBe('PROFESSIONAL');

    const audit = await AuditLogModel.findOne({ action: 'CHECKOUT_COMPLETED', workspaceId });
    expect(audit?.metadata?.packageId).toBe('BUSINESS');
    const conversion = await ConversionEventModel.findOne({
      event: 'SUBSCRIPTION_STARTED',
      workspaceId,
    }).lean();
    expect(conversion?.packageId).toBe('BUSINESS');
  });

  it('reports the workspace as already subscribed on a repeat verification', async () => {
    const verification = await scoped(request.post('/api/v1/billing/checkout/verify')).send({
      paymentId: 'pi_paid_billing_flow_1',
      packageId: 'BUSINESS',
    });
    expect(verification.status).toBe(200);
    expect(verification.body.activated).toBe(false);
    expect(verification.body.alreadyActive).toBe(true);
    expect(verification.body.reason).toBe('ALREADY_ON_PACKAGE');
  });
  it('rejects a checkout for the package the workspace already holds', async () => {
    const response = await scoped(request.post('/api/v1/billing/checkout')).send({
      packageId: 'BUSINESS',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_ON_PACKAGE');
  });

  it('lists the verified payment history for the console', async () => {
    const response = await scoped(request.get('/api/v1/billing/payments'));
    expect(response.status).toBe(200);
    expect(response.body.payments.length).toBeGreaterThan(0);
    expect(response.body.payments[0].workspaceId.toString()).toBe(workspaceId);
  });
});
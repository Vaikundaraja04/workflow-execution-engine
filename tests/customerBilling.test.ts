import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { PaymentRecordModel } from '../src/models/PaymentRecordModel.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 15.2 - Customer billing console read models and plan-change rights.
 */

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-customer-billing-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const ownerEmail = 'console-owner@acme.test';
const viewerEmail = 'console-viewer@acme.test';
let ownerToken = '';
let viewerToken = '';
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
    name: 'Console Owner',
    companyName: 'Console Co',
  });
  ownerToken = signup.body.tokens.accessToken;
  workspaceId = signup.body.workspace.id;

  const viewer = await request.post('/api/v1/saas/signup').send({
    email: viewerEmail,
    password: 'FounderPass123!',
    name: 'Console Viewer',
    companyName: 'Viewer Co',
  });
  viewerToken = viewer.body.tokens.accessToken;

  const invite = await request
    .post(`/api/workspaces/${workspaceId}/members/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email: viewerEmail, role: 'VIEWER' });
  expect([201, 200]).toContain(invite.status);
  const accept = await request
    .post(`/api/workspaces/${workspaceId}/members/accept`)
    .set('Authorization', `Bearer ${viewerToken}`)
    .send({});
  expect(accept.status).toBe(200);
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const owner = (req: supertest.Test) =>
  req.set('Authorization', `Bearer ${ownerToken}`).set('X-Workspace-Id', workspaceId);
const viewer = (req: supertest.Test) =>
  req.set('Authorization', `Bearer ${viewerToken}`).set('X-Workspace-Id', workspaceId);
describe('Phase 15.2 billing console read models', () => {
  it('serves the plan catalog with the plan aliases', async () => {
    const response = await request.get('/api/v1/billing/plans');
    expect(response.status).toBe(200);
    expect(response.body.plans.map((plan: { id: string }) => plan.id)).toContain('PROFESSIONAL');
    expect(response.body.aliases.BUSINESS).toBe('PROFESSIONAL');
  });

  it('returns the account read model for a member', async () => {
    const response = await owner(request.get('/api/v1/saas/account'));
    expect(response.status).toBe(200);
    expect(response.body.tenant.plan).toBe('FREE');
    expect(response.body.subscription).toBeTruthy();
    expect(response.body.usage).toBeTruthy();
  });

  it('serves the entitlement summary the console renders', async () => {
    const response = await owner(request.get('/api/v1/entitlements'));
    expect(response.status).toBe(200);
    expect(response.body.plan).toBe('FREE');
    expect(Array.isArray(response.body.features)).toBe(true);
  });

  it('returns the current subscription and the provider invoices', async () => {
    const subscription = await owner(request.get('/api/v1/billing/subscription'));
    expect(subscription.status).toBe(200);
    expect(subscription.body.plan).toBe('FREE');

    const invoices = await owner(request.get('/api/v1/billing/invoices'));
    expect(invoices.status).toBe(200);
    expect(Array.isArray(invoices.body.invoices)).toBe(true);
  });
  it('scopes verified payment records to the workspace', async () => {
    const empty = await owner(request.get('/api/v1/billing/payments'));
    expect(empty.status).toBe(200);
    expect(empty.body.payments).toEqual([]);

    await PaymentRecordModel.create({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      provider: 'mock',
      paymentId: 'pi_console_1',
      amount: 9900,
      amountReceived: 9900,
      currency: 'usd',
      status: 'succeeded',
      paid: true,
      activated: true,
      providerCreatedAt: 1,
    });

    const listed = await owner(request.get('/api/v1/billing/payments'));
    expect(listed.body.payments.length).toBe(1);
    expect(listed.body.payments[0].paymentId).toBe('pi_console_1');

    const anonymous = await request.get('/api/v1/billing/payments');
    expect(anonymous.status).toBe(401);
  });

  it('lets an owner upgrade and downgrade the plan', async () => {
    const upgrade = await owner(request.post('/api/v1/billing/upgrade')).send({ plan: 'STARTER' });
    expect(upgrade.status).toBe(200);
    expect(upgrade.body.subscription.plan).toBe('STARTER');

    const entitlements = await owner(request.get('/api/v1/entitlements'));
    expect(entitlements.body.plan).toBe('STARTER');

    const downgrade = await owner(request.post('/api/v1/billing/downgrade')).send({ plan: 'FREE' });
    expect(downgrade.status).toBe(200);
    expect(downgrade.body.subscription.plan).toBe('FREE');
  });

  it('denies plan changes to a viewer member', async () => {
    const upgrade = await viewer(request.post('/api/v1/billing/upgrade')).send({ plan: 'PROFESSIONAL' });
    expect(upgrade.status).toBe(403);
    expect(upgrade.body.error.code).toBe('FORBIDDEN');

    const downgrade = await viewer(request.post('/api/v1/billing/downgrade')).send({ plan: 'FREE' });
    expect(downgrade.status).toBe(403);
  });
});
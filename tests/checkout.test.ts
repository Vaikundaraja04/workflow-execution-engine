import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { railsForProvider } from '../src/services/checkoutService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 15.3 - Checkout session creation, rail reporting and authorization.
 */

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-checkout-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const ownerEmail = 'checkout-owner@acme.test';
const outsiderEmail = 'checkout-outsider@acme.test';
let ownerToken = '';
let outsiderToken = '';
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
    name: 'Checkout Owner',
    companyName: 'Checkout Co',
  });
  ownerToken = signup.body.tokens.accessToken;
  workspaceId = signup.body.workspace.id;

  const outsider = await request.post('/api/v1/saas/signup').send({
    email: outsiderEmail,
    password: 'FounderPass123!',
    name: 'Outsider',
    companyName: 'Other Co',
  });
  outsiderToken = outsider.body.tokens.accessToken;
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const scoped = (req: supertest.Test) =>
  req.set('Authorization', `Bearer ${ownerToken}`).set('X-Workspace-Id', workspaceId);

describe('Phase 15.3 checkout sessions', () => {
  it('reports the rails each provider accepts', () => {
    expect(railsForProvider('razorpay')).toEqual(['card', 'upi', 'google_pay', 'netbanking']);
    expect(railsForProvider('stripe')).toEqual(['card']);
    expect(railsForProvider('mock')).toEqual(['card']);
    expect(railsForProvider('unknown')).toEqual(['card']);
  });

  it('creates a session for every sellable package at the catalog price', async () => {
    for (const [packageId, plan, amount] of [
      ['STARTER', 'STARTER', 2900],
      ['BUSINESS', 'PROFESSIONAL', 9900],
    ] as const) {
      const response = await scoped(request.post('/api/v1/billing/checkout')).send({ packageId });
      expect(response.status).toBe(201);
      expect(response.body.session.packageId).toBe(packageId);
      expect(response.body.session.plan).toBe(plan);
      expect(response.body.session.amount).toBe(amount);
      expect(response.body.session.status).toBe('requires_payment_method');
    }
  });
  it('accepts an explicit provider and currency', async () => {
    const response = await scoped(request.post('/api/v1/billing/checkout')).send({
      packageId: 'ENTERPRISE',
      provider: 'mock',
      currency: 'USD',
    });
    expect(response.status).toBe(201);
    expect(response.body.session.provider).toBe('mock');
    expect(response.body.session.currency).toBe('usd');
    expect(response.body.session.packageId).toBe('ENTERPRISE');
  });

  it('rejects an unknown package', async () => {
    const response = await scoped(request.post('/api/v1/billing/checkout')).send({
      packageId: 'PLATINUM',
    });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_PLAN_NOT_FOUND');
  });

  it('rejects a malformed checkout body', async () => {
    const response = await scoped(request.post('/api/v1/billing/checkout')).send({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });
  it('requires authentication and workspace membership', async () => {
    const anonymous = await request.post('/api/v1/billing/checkout').send({ packageId: 'STARTER' });
    expect(anonymous.status).toBe(401);

    const foreign = await request
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Workspace-Id', workspaceId)
      .send({ packageId: 'STARTER' });
    // A workspace the caller is not a member of is hidden as not found.
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('scopes payment history to the requesting workspace', async () => {
    const response = await request
      .get('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Workspace-Id', workspaceId);
    expect(response.status).toBe(404);
  });
});
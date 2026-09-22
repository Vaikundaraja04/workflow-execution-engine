import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { conversionTrackingService } from '../src/services/conversionTrackingService.js';
import { businessAnalyticsService } from '../src/services/businessAnalyticsService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 15.8 - Business analytics dashboard.
 *
 * Funnel rates, MRR/ARPA, active customers, churn and the admin-only gate.
 */

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-conversion-dashboard-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'dashboard-admin@acme.test';
let adminToken = '';
let memberToken = '';
let workspaceId = '';
let secondWorkspaceId = '';
let churnedWorkspaceId = '';

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
    password: 'FounderPass123!',
    name: 'Dashboard Admin',
    companyName: 'Admin Co',
  });
  adminToken = admin.body.tokens.accessToken;
  workspaceId = admin.body.workspace.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: 'dashboard-member@acme.test',
    password: 'FounderPass123!',
    name: 'Dashboard Member',
    companyName: 'Member Co',
  });
  memberToken = member.body.tokens.accessToken;
  secondWorkspaceId = member.body.workspace.id;

  const churned = await request.post('/api/v1/saas/signup').send({
    email: 'dashboard-churned@acme.test',
    password: 'FounderPass123!',
    name: 'Churned Customer',
    companyName: 'Churned Co',
  });
  churnedWorkspaceId = churned.body.workspace.id;
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);
describe('Phase 15.8 business analytics', () => {
  it('is restricted to platform administrators', async () => {
    const anonymous = await request.get('/api/v1/analytics/business');
    expect(anonymous.status).toBe(401);

    const member = await request
      .get('/api/v1/analytics/business')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(member.status).toBe(403);
  });

  it('reports an empty funnel and no revenue before any activity', async () => {
    const response = await request
      .get('/api/v1/analytics/business')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.acquisition.visitors).toBe(0);
    expect(response.body.acquisition.visitToSignupPercent).toBe(0);
    expect(response.body.revenue.mrr).toBe(0);
    expect(response.body.revenue.planMix).toEqual([]);
    expect(response.body.customers.churned).toBe(0);
  });

  it('rejects an out-of-range window', async () => {
    const response = await request
      .get('/api/v1/analytics/business?days=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });
  it('computes funnel rates from recorded conversion events', async () => {
    const before = await businessAnalyticsService.report({ days: 30 });
    for (let index = 0; index < 4; index += 1) {
      await conversionTrackingService.record({ event: 'LANDING_VIEW', source: 'TEST' });
    }
    for (let index = 0; index < 2; index += 1) {
      await conversionTrackingService.record({ event: 'SIGNUP_COMPLETED', workspaceId, source: 'TEST' });
    }
    await conversionTrackingService.record({ event: 'DEMO_CREATED', workspaceId, source: 'TEST' });

    const after = await businessAnalyticsService.report({ days: 30 });
    expect(after.acquisition.visitors - before.acquisition.visitors).toBe(4);
    expect(after.acquisition.signups - before.acquisition.signups).toBe(2);
    expect(after.acquisition.demos - before.acquisition.demos).toBe(1);
    expect(after.acquisition.visitToSignupPercent).toBeGreaterThan(0);
    expect(after.window.days).toBe(30);
    expect(after.acquisition.bySource.some((entry) => entry.source === 'TEST')).toBe(true);
  });

  it('prices MRR, ARPA and the plan mix from the packaged catalog', async () => {
    await SubscriptionModel.updateOne(
      { workspaceId },
      { $set: { plan: 'PROFESSIONAL', status: 'ACTIVE' } },
    );
    await SubscriptionModel.updateOne(
      { workspaceId: secondWorkspaceId },
      { $set: { plan: 'STARTER', status: 'ACTIVE' } },
    );

    const report = await businessAnalyticsService.report({ days: 30 });
    expect(report.revenue.currency).toBe('USD');
    expect(report.revenue.payingCustomers).toBe(2);
    expect(report.revenue.mrr).toBe(12800);
    expect(report.revenue.arr).toBe(12800 * 12);
    expect(report.revenue.arpa).toBe(6400);
    expect(report.revenue.trialingCustomers).toBe(0);

    const business = report.revenue.planMix.find((entry) => entry.packageId === 'BUSINESS');
    expect(business?.subscriptions).toBe(1);
    expect(business?.mrr).toBe(9900);
    expect(report.revenue.planMix[0]?.packageId).toBe('BUSINESS');
  });
  it('reports active customers, trials ending soon and churn', async () => {
    await SubscriptionModel.updateOne(
      { workspaceId: churnedWorkspaceId },
      { $set: { plan: 'STARTER', status: 'CANCELLED' } },
    );

    const response = await request
      .get('/api/v1/analytics/business?days=30')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.customers.active).toBe(2);
    expect(response.body.customers.churned).toBe(1);
    expect(response.body.customers.startingBase).toBeGreaterThanOrEqual(1);
    expect(response.body.customers.churnRatePercent).toBeGreaterThan(0);
    expect(response.body.customers.trialsEndingSoon).toBe(0);
    expect(response.body.health.atRisk).toBeGreaterThanOrEqual(0);
    expect(response.body.generatedAt).toBeTruthy();
  });
});
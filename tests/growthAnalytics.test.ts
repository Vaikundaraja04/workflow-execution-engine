import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { GrowthEventModel } from '../src/models/GrowthEventModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { NotificationLogModel } from '../src/models/NotificationLogModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { growthAnalyticsService } from '../src/services/growthAnalyticsService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-growth-analytics',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'growth-admin@acme.test';
const memberEmail = 'growth-member@acme.test';
let adminToken = '';
let memberToken = '';
let workspaceId = '';
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
    password: 'GrowthPass123!',
    name: 'Growth Admin',
    companyName: 'Growth Test Co',
  });
  adminToken = admin.body.tokens.accessToken;
  workspaceId = admin.body.workspace.id;
  adminUserId = admin.body.user.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: memberEmail,
    password: 'MemberPass123!',
    name: 'Growth Member',
    companyName: 'Member Test Co',
  });
  memberToken = member.body.tokens.accessToken;
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authed = (req: supertest.Test) => req.set('Authorization', `Bearer ${adminToken}`);

describe('Phase 16.1 growth analytics ledger', () => {
  it('records lifecycle events and de-duplicates recordOnce hooks', async () => {
    await growthAnalyticsService.record({ event: 'LANDING_VIEW', source: 'WEBSITE' });
    await growthAnalyticsService.record({ event: 'LANDING_VIEW', source: 'PRICING_PAGE' });
    await growthAnalyticsService.record({ event: 'SIGNUP_COMPLETED', workspaceId, userId: adminUserId, source: 'WEBSITE' });
    await growthAnalyticsService.record({ event: 'DEMO_STARTED', workspaceId, source: 'DEMO_SCENARIO' });
    await growthAnalyticsService.record({ event: 'TRIAL_STARTED', workspaceId, plan: 'STARTER' });
    await growthAnalyticsService.record({ event: 'PAYMENT_COMPLETED', workspaceId, amount: 499900, currency: 'USD' });
    await growthAnalyticsService.record({ event: 'CUSTOMER_CONVERTED', workspaceId, source: 'WEBSITE' });

    const first = await growthAnalyticsService.recordOnce({ event: 'TRIAL_ACTIVATED', workspaceId });
    const second = await growthAnalyticsService.recordOnce({ event: 'TRIAL_ACTIVATED', workspaceId });
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await GrowthEventModel.countDocuments({ workspaceId: new Types.ObjectId(workspaceId) })).toBe(6);
  });

  it('builds the acquisition funnel with step conversion and source attribution', async () => {
    const res = await authed(request.get('/api/v1/growth/funnel?days=30')).expect(200);
    expect(res.body.steps.map((step: { event: string }) => step.event)).toEqual([
      'LANDING_VIEW', 'SIGNUP_STARTED', 'SIGNUP_COMPLETED', 'DEMO_REQUESTED', 'DEMO_STARTED',
      'TRIAL_STARTED', 'TRIAL_ACTIVATED', 'PAYMENT_COMPLETED', 'CUSTOMER_CONVERTED', 'CUSTOMER_CHURNED',
    ]);
    expect(res.body.steps[0].conversionFromPrevious).toBeNull();
    expect(res.body.totals.visitors).toBe(2);
    expect(res.body.totals.signups).toBe(1);
    expect(res.body.totals.customers).toBe(1);
    expect(res.body.rates.visitorToSignupPercent).toBe(50);
    const website = res.body.bySource.find((row: { source: string }) => row.source === 'WEBSITE');
    expect(website?.signups).toBe(1);
    expect(website?.customers).toBe(1);
  });

  it('validates funnel query parameters', async () => {
    await authed(request.get('/api/v1/growth/funnel?days=400')).expect(400);
    await authed(request.get('/api/v1/growth/funnel?days=abc')).expect(400);
  });

  it('computes CAC only when marketing spend is supplied', async () => {
    const without = await authed(request.get('/api/v1/growth/conversion?days=30')).expect(200);
    expect(without.body.cac.spend).toBeNull();
    expect(without.body.cac.costPerAcquisition).toBeNull();
    expect(without.body.cac.note).toContain('not supplied');

    const withSpend = await authed(request.get('/api/v1/growth/conversion?days=30&spend=250000&currency=usd')).expect(200);
    expect(withSpend.body.cac.spend).toBe(250000);
    expect(withSpend.body.cac.currency).toBe('USD');
    expect(withSpend.body.cac.customersAcquired).toBe(1);
    expect(withSpend.body.cac.costPerAcquisition).toBe(250000);
  });

  it('measures activation as the first execution within 14 days of signup', async () => {
    await WorkflowExecutionModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      workflowId: new Types.ObjectId(),
      ownerId: new Types.ObjectId(adminUserId),
      workflowVersionId: new Types.ObjectId(),
      versionNumber: 1,
      jobId: 'growth-exec-1',
      idempotencyKey: 'growth-exec-1',
      inputHash: 'growth-hash-1',
      input: {},
      status: 'SUCCEEDED',
    });
    const res = await authed(request.get('/api/v1/growth/conversion?days=30')).expect(200);
    expect(res.body.activation.evaluated).toBe(1);
    expect(res.body.activation.activated).toBe(1);
    expect(res.body.activation.activationRatePercent).toBe(100);
  });

  it('builds monthly retention cohorts from signups and execution activity', async () => {
    const res = await authed(request.get('/api/v1/growth/retention?months=3')).expect(200);
    expect(res.body.cohorts.length).toBeGreaterThan(0);
    const cohort = res.body.cohorts[0];
    expect(cohort.cohortMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(cohort.size).toBe(1);
    expect(cohort.retained[0]).toMatchObject({ monthOffset: 0, active: 1, percent: 100 });
    expect(res.body.churn.churnedInWindow).toBe(0);
    expect(res.body.ltv.churnRatePercent).toBe(0);
    expect(res.body.ltv.estimatedLifetimeMonths).toBeNull();
  });
});

describe('Phase 16.5 lifecycle automation', () => {
  it('sweeps trial-started emails once and records the audit trail', async () => {
    await SubscriptionModel.updateOne(
      { workspaceId: new Types.ObjectId(workspaceId) },
      { $set: { status: 'TRIALING', plan: 'STARTER', trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } },
    );
    const first = await authed(request.post('/api/v1/growth/lifecycle/run')).send({ rules: ['TRIAL_STARTED'] }).expect(200);
    const ours = first.body.sent.filter((entry: { workspaceId: string }) => entry.workspaceId === workspaceId);
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ rule: 'TRIAL_STARTED', template: 'TRIAL_STARTED' });
    expect(await NotificationLogModel.countDocuments({ template: 'TRIAL_STARTED', workspaceId: new Types.ObjectId(workspaceId) })).toBe(1);

    const second = await authed(request.post('/api/v1/growth/lifecycle/run')).send({ rules: ['TRIAL_STARTED'] }).expect(200);
    expect(second.body.sent.filter((entry: { workspaceId: string }) => entry.workspaceId === workspaceId)).toHaveLength(0);
    expect(second.body.skipped.some((skip: { workspaceId: string; reason: string }) => skip.workspaceId === workspaceId && skip.reason.includes('already sent'))).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'LIFECYCLE_SWEEP_RUN' })).toBe(2);
  });

  it('lists the lifecycle notification log and validates the sweep input', async () => {
    const log = await authed(request.get('/api/v1/growth/lifecycle/log?status=SENT')).expect(200);
    expect(Array.isArray(log.body.notifications)).toBe(true);
    expect(log.body.notifications.length).toBeGreaterThan(0);
    await authed(request.get('/api/v1/growth/lifecycle/log?status=NOPE')).expect(400);
    await authed(request.post('/api/v1/growth/lifecycle/run')).send({ rules: ['NOT_A_RULE'] }).expect(400);
    await authed(request.post('/api/v1/growth/lifecycle/run')).send({ unknown: true }).expect(400);
  });

  it('restricts growth analytics to platform administrators', async () => {
    await request.get('/api/v1/growth/funnel').expect(401);
    await request.get('/api/v1/growth/funnel').set('Authorization', `Bearer ${memberToken}`).expect(403);
    await request.post('/api/v1/growth/lifecycle/run').set('Authorization', `Bearer ${memberToken}`).send({}).expect(403);
  });
});

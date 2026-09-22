import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AIFeaturePolicyModel, AIPromptPolicyModel } from '../src/models/AIGovernancePolicyModel.js';
import { leadService } from '../src/services/leadService.js';
import { salesIntelligenceService } from '../src/services/salesIntelligenceService.js';
import { conversionTrackingService } from '../src/services/conversionTrackingService.js';
import { growthAnalyticsService } from '../src/services/growthAnalyticsService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-sales-intelligence',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'sales-admin@acme.test';
const memberEmail = 'sales-member@acme.test';
let adminToken = '';
let memberToken = '';
let workspaceId = '';
let adminUserId = '';
let leadId = '';

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
    password: 'SalesPass123!',
    name: 'Sales Admin',
    companyName: 'Sales Test Co',
  });
  adminToken = admin.body.tokens.accessToken;
  workspaceId = admin.body.workspace.id;
  adminUserId = admin.body.user.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: memberEmail,
    password: 'MemberPass123!',
    name: 'Sales Member',
    companyName: 'Member Test Co',
  });
  memberToken = member.body.tokens.accessToken;

  const captured = await leadService.capture({
    company: 'Initech',
    contactName: 'Peter Gibbons',
    contactEmail: 'peter@growth-sales.test',
    industry: 'Technology',
    companySize: '201-1000',
    interest: 'BUSINESS',
    message: 'We need approval automation across three teams',
    source: 'PRICING_PAGE',
  });
  leadId = captured.lead.id;
  await leadService.update(leadId, { status: 'QUALIFIED', estimatedValueMonthly: 9900, workspaceId }, adminUserId);
  await conversionTrackingService.record({ event: 'LANDING_VIEW', source: 'PRICING_PAGE', leadId, workspaceId });
  await growthAnalyticsService.record({ event: 'DEMO_STARTED', leadId, workspaceId });
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authed = (req: supertest.Test) => req.set('Authorization', `Bearer ${adminToken}`);

describe('Phase 16.2 sales intelligence', () => {
  it('scores a lead from firmographics and recorded engagement', async () => {
    const intelligence = await salesIntelligenceService.scoreLead(leadId);
    expect(intelligence.score).toBeGreaterThan(0);
    expect(intelligence.score).toBeLessThanOrEqual(100);
    expect(['HOT', 'WARM', 'NURTURE', 'COLD']).toContain(intelligence.band);
    expect(intelligence.factors).toHaveLength(4);
    expect(intelligence.engagement.pricingVisits).toBe(1);
    expect(intelligence.engagement.lastActivityAt).toBeTruthy();
    expect(intelligence.companyPriority.tier).toBeTruthy();
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(intelligence.buyingIntent.band);
    expect(intelligence.recommendations.length).toBeGreaterThan(0);
    expect(intelligence.followUpStatus).toBeTruthy();
  });

  it('ranks the pipeline and exposes per-lead scores to admins', async () => {
    const report = await authed(request.get('/api/v1/sales/intelligence')).expect(200);
    const entry = report.body.leads.find((lead: { leadId: string }) => lead.leadId === leadId);
    expect(entry).toBeTruthy();
    expect(entry.company).toBe('Initech');
    expect(entry.score).toBeGreaterThan(0);
    expect(report.body.summary.total).toBeGreaterThan(0);
    expect(report.body.summary.topOpportunity.company).toBeTruthy();

    const single = await authed(request.get(`/api/v1/sales/leads/${leadId}/score`)).expect(200);
    expect(single.body.leadId).toBe(leadId);
    expect(single.body.score).toBe(entry.score);

    await authed(request.get('/api/v1/sales/leads/not-an-id/score')).expect(400);
    await authed(request.get('/api/v1/sales/leads/' + new Types.ObjectId().toString() + '/score')).expect(404);
  });

  it('generates a proposal through the governance gate', async () => {
    const res = await authed(request.post('/api/v1/sales/proposals')).send({ leadId, notes: 'Expect a pricing objection' }).expect(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.proposal.company).toBe('Initech');
    expect(res.body.proposal.estimateMonthly).toBe(9900);
    expect(res.body.proposal.score).toBeGreaterThan(0);
    expect(res.body.proposal.sections.length).toBeGreaterThan(0);
    expect(res.body.proposal.model).toBe('mock-model');
    expect(res.body.proposal.providerName).toBe('mock');
    expect(res.body.governance.decision).toBe('ALLOW');
  });

  it('returns a pending approval, then denies generation, when policy blocks it', async () => {
    await AIPromptPolicyModel.create({ workspaceId: new Types.ObjectId(workspaceId), requiredApprovalPatterns: ['B2B sales proposal'] });
    const pending = await authed(request.post('/api/v1/sales/proposals')).send({ leadId }).expect(202);
    expect(pending.body.status).toBe('PENDING_APPROVAL');
    expect(pending.body.approvalId).toBeTruthy();
    expect(pending.body.proposal).toBeUndefined();

    await AIPromptPolicyModel.updateOne(
      { workspaceId: new Types.ObjectId(workspaceId) },
      { $set: { requiredApprovalPatterns: [], blockedPatterns: ['B2B sales proposal'] } },
    );
    const denied = await authed(request.post('/api/v1/sales/proposals')).send({ leadId }).expect(403);
    expect(denied.body.error.code).toBe('AI_GOVERNANCE_DENIED');

    await AIPromptPolicyModel.deleteMany({ workspaceId: new Types.ObjectId(workspaceId) });
    await AIFeaturePolicyModel.create({ workspaceId: new Types.ObjectId(workspaceId), feature: 'AI_ANALYSIS', enabled: false });
    const featureDenied = await authed(request.post('/api/v1/sales/proposals')).send({ leadId }).expect(403);
    expect(featureDenied.body.error.code).toBe('AI_GOVERNANCE_DENIED');
    await AIFeaturePolicyModel.deleteMany({ workspaceId: new Types.ObjectId(workspaceId) });
  });

  it('validates proposal requests and restricts the sales surface', async () => {
    await request.post('/api/v1/sales/proposals').send({ leadId }).expect(401);
    await request.post('/api/v1/sales/proposals').set('Authorization', `Bearer ${memberToken}`).send({ leadId }).expect(403);
    await authed(request.post('/api/v1/sales/proposals')).send({}).expect(400);
    await authed(request.post('/api/v1/sales/proposals')).send({ leadId, extra: true }).expect(400);
    await authed(request.post('/api/v1/sales/proposals')).send({ leadId: new Types.ObjectId().toString() }).expect(404);
    await request.get('/api/v1/sales/intelligence').set('Authorization', `Bearer ${memberToken}`).expect(403);
  });
});

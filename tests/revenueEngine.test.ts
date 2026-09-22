import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { LeadModel } from '../src/models/LeadModel.js';
import { ProductPlanModel } from '../src/models/ProductPlanModel.js';
import { ConversionEventModel } from '../src/models/ConversionEventModel.js';
import { AgentModel } from '../src/models/AgentModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { productPackagingService } from '../src/services/productPackagingService.js';
import { featureEntitlementService } from '../src/services/featureEntitlementService.js';
import { leadService } from '../src/services/leadService.js';
import { conversionTrackingService } from '../src/services/conversionTrackingService.js';
import { solutionTemplateService } from '../src/services/solutionTemplateService.js';
import { customerHealthService } from '../src/services/customerHealthService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-revenue-engine-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const ownerEmail = 'gtm-owner@acme.test';
let ownerToken = '';
let workspaceId = '';
let ownerUserId = '';

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = ownerEmail;
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
    name: 'GTM Owner',
    companyName: 'GTM Test Co',
  });
  ownerToken = signup.body.tokens.accessToken;
  workspaceId = signup.body.workspace.id;
  ownerUserId = signup.body.user.id;
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authed = (req: supertest.Test) => req.set('Authorization', `Bearer ${ownerToken}`);
const scoped = (req: supertest.Test) => authed(req).set('X-Workspace-Id', workspaceId);

describe('Phase 14.1 product packaging', () => {
  it('seeds the sellable catalog with the three packages', async () => {
    const plans = await productPackagingService.listProductPlans();
    expect(plans.map((plan) => plan.id).sort()).toEqual(['BUSINESS', 'ENTERPRISE', 'STARTER']);
    const business = plans.find((plan) => plan.id === 'BUSINESS');
    expect(business?.internalPlan).toBe('PROFESSIONAL');
    expect(business?.packaging.executionLimit).toBeGreaterThan(0);
    expect(await ProductPlanModel.countDocuments()).toBe(3);
  });

  it('resolves package ids from internal plan names', async () => {
    expect(productPackagingService.packageForPlan('PROFESSIONAL')).toBe('BUSINESS');
    expect(productPackagingService.packageForPlan('FREE')).toBeNull();
    const plan = await productPackagingService.getProductPlan('PROFESSIONAL');
    expect(plan.id).toBe('BUSINESS');
  });

  it('compares packages and reports what an upgrade adds', async () => {
    const comparison = await productPackagingService.compareProductPlans('STARTER', 'BUSINESS');
    expect(comparison.upgrade).toBe(true);
    expect(comparison.priceDeltaPercent).toBeGreaterThan(0);
    expect(comparison.entitlementsAdded).toContain('AI_AGENTS');
    expect(comparison.entitlementsRemoved).toEqual([]);
    const executions = comparison.limitDeltas.find((delta) => delta.field === 'executionLimit');
    expect(executions?.delta).toBeGreaterThan(0);
  });

  it('packages a workspace from a package id or plan alias', () => {
    const packaged = productPackagingService.packageWorkspace('BUSINESS', 'operations');
    expect(packaged.sellablePackageId).toBe('BUSINESS');
    expect(packaged.sellablePlan).toBe('PROFESSIONAL');
    expect(packaged.packaging.supportLevel).toBeDefined();
    expect(productPackagingService.packageWorkspace('unknown', 'x').sellablePackageId).toBe('STARTER');
  });
});

describe('Phase 14.2 feature entitlement engine', () => {
  it('keeps RBAC authoritative and gates unentitled features', async () => {
    const summary = await featureEntitlementService.getSummary(workspaceId);
    expect(summary.plan).toBe('FREE');
    expect(summary.packageId).toBeNull();
    expect(summary.features.length).toBeGreaterThan(0);
    const sso = summary.features.find((entry) => entry.feature === 'SSO');
    expect(sso?.entitled).toBe(false);
    expect(sso?.reason).toBe('PLAN_UPGRADE_REQUIRED');
  });

  it('reports the minimum plan required for a feature', () => {
    expect(featureEntitlementService.isFeatureKey('SSO')).toBe(true);
    expect(featureEntitlementService.isFeatureKey('NOT_A_FEATURE')).toBe(false);
    expect(featureEntitlementService.planIncludes('ENTERPRISE', 'SSO')).toBe(true);
    expect(featureEntitlementService.planIncludes('FREE', 'SSO')).toBe(false);
    expect(featureEntitlementService.featuresForPlan('FREE')).toContain('WORKFLOWS');
  });

  it('denies a feature when the role lacks the matching permission', async () => {
    const decision = await featureEntitlementService.evaluate(workspaceId, 'AUDIT_LOGS', { role: 'VIEWER' });
    expect(decision.entitled).toBe(false);
    expect(['ROLE_NOT_PERMITTED', 'PLAN_UPGRADE_REQUIRED']).toContain(decision.reason);
  });

  it('reports NO_SUBSCRIPTION for a workspace without one', async () => {
    const orphan = new mongoose.Types.ObjectId();
    const decision = await featureEntitlementService.evaluate(orphan, 'WORKFLOWS');
    expect(decision.entitled).toBe(false);
    expect(decision.reason).toBe('NO_SUBSCRIPTION');
    expect(decision.requiredPlan).toBeDefined();
  });

  it('throws FEATURE_NOT_ENTITLED through assertFeature', async () => {
    await expect(featureEntitlementService.assertFeature(workspaceId, 'SSO')).rejects.toThrow('FEATURE_NOT_ENTITLED');
  });
});

describe('Phase 14.5 lead management', () => {
  it('captures an inbound lead once per contact email', async () => {
    const first = await leadService.capture({
      company: 'Initech',
      contactName: 'Peter Gibbons',
      contactEmail: 'peter@initech.test',
      industry: 'Technology',
      companySize: '51-200',
      interest: 'BUSINESS',
      message: 'We need approval automation',
      source: 'PRICING_PAGE',
    });
    expect(first.duplicateOf).toBeNull();
    expect(first.lead.status).toBe('NEW');
    expect(first.lead.score.score).toBeGreaterThan(0);
    expect(first.lead.nextAction).toBeTruthy();

    const repeat = await leadService.capture({
      company: 'Initech',
      contactName: 'Peter Gibbons',
      contactEmail: 'peter@initech.test',
      message: 'Following up',
      source: 'DEMO_REQUEST',
    });
    expect(repeat.duplicateOf).toBe(first.lead.id);
    expect(await LeadModel.countDocuments({ contactEmail: 'peter@initech.test' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'LEAD_CAPTURED' })).toBe(2);
  });

  it('lists leads with filters and rolls up the pipeline', async () => {
    const result = await leadService.list({ source: 'PRICING_PAGE', limit: 10 });
    expect(result.total).toBe(1);
    expect(result.leads[0]?.company).toBe('Initech');
    expect(result.pipeline.stages.length).toBeGreaterThan(0);
    expect(result.pipeline.totals.leads).toBeGreaterThan(0);
  });

  it('updates qualification fields, notes and demo linkage', async () => {
    const lead = await LeadModel.findOne({ contactEmail: 'peter@initech.test' });
    const leadId = lead!._id.toString();

    const updated = await leadService.update(leadId, {
      status: 'DEMO_SCHEDULED',
      note: 'Qualified on the discovery call',
      markContacted: true,
      estimatedValueMonthly: 9900,
    }, ownerUserId);
    expect(updated.status).toBe('DEMO_SCHEDULED');
    expect(updated.notes.length).toBe(1);
    expect(updated.lastContactedAt).toBeTruthy();
    expect(updated.nextAction).toBeTruthy();

    const demoWorkspaceId = new mongoose.Types.ObjectId().toString();
    const linked = await leadService.attachDemo(leadId, {
      demoWorkspaceId,
      demoExpiresAt: new Date(Date.now() + 86400000),
      demoStatus: 'CREATED',
    }, ownerUserId);
    expect(linked.demoWorkspaceId).toBe(demoWorkspaceId);
    expect(linked.demoStatus).toBe('CREATED');

    const audit = await AuditLogModel.findOne({ action: 'LEAD_UPDATED', resourceId: leadId });
    expect(audit).toBeTruthy();
  });
});

describe('Phase 14.9 conversion tracking', () => {
  it('records funnel events and reports step conversion', async () => {
    await conversionTrackingService.record({ event: 'LANDING_VIEW', source: 'organic' });
    await conversionTrackingService.record({ event: 'LANDING_VIEW', source: 'organic' });
    await conversionTrackingService.record({ event: 'LANDING_VIEW', source: 'paid' });
    await conversionTrackingService.record({ event: 'SIGNUP_COMPLETED', workspaceId, source: 'organic' });
    expect(await ConversionEventModel.countDocuments()).toBe(4);

    const report = await conversionTrackingService.funnel({ days: 7 });
    const landing = report.steps.find((step) => step.event === 'LANDING_VIEW');
    const signups = report.steps.find((step) => step.event === 'SIGNUP_COMPLETED');
    expect(landing?.count).toBe(3);
    expect(signups?.count).toBe(1);
    expect(report.totals.visitors).toBe(3);
    expect(report.totals.signups).toBe(1);
    expect(report.rates.visitToSignupPercent).toBeCloseTo(33.3, 0);

    const organic = report.bySource.find((entry) => entry.source === 'organic');
    expect(organic?.landing).toBe(2);
    expect(organic?.signups).toBe(1);
  });

  it('writes analytics events without touching the audit chain', async () => {
    const auditBefore = await AuditLogModel.countDocuments();
    await conversionTrackingService.recordSafely({ event: 'LANDING_VIEW', source: 'organic' });
    expect(await AuditLogModel.countDocuments()).toBe(auditBefore);
  });
});

describe('Phase 14.6 industry solutions', () => {
  it('lists the packaged solutions and rejects unknown ids', () => {
    const solutions = solutionTemplateService.listSolutions();
    expect(solutions.length).toBeGreaterThan(0);
    expect(solutions[0]?.workflowCount).toBeGreaterThan(0);

    const filtered = solutionTemplateService.listSolutions({ packageId: 'ENTERPRISE' });
    expect(Array.isArray(filtered)).toBe(true);

    const first = solutionTemplateService.getSolution(solutions[0]!.id);
    expect(first.id).toBe(solutions[0]!.id);
    expect(() => solutionTemplateService.getSolution('not-a-solution')).toThrow('SOLUTION_NOT_FOUND');
  });

  it('installs a solution into a workspace with its workflows and agents', async () => {
    const [solution] = solutionTemplateService.listSolutions();
    const workflowsBefore = await WorkflowModel.countDocuments({ workspaceId });
    const agentsBefore = await AgentModel.countDocuments({ workspaceId });
    const result = await solutionTemplateService.install(solution!.id, {
      workspaceId,
      userId: ownerUserId,
    });

    expect(result.solutionId).toBe(solution!.id);
    expect(result.workspaceId).toBe(workspaceId);
    expect(await WorkflowModel.countDocuments({ workspaceId })).toBe(workflowsBefore + result.workflowIds.length);
    expect(await AgentModel.countDocuments({ workspaceId })).toBe(agentsBefore + result.agentIds.length);
    expect(await AuditLogModel.countDocuments({ action: 'SOLUTION_INSTALLED' })).toBeGreaterThan(0);
  });
});

describe('Phase 14.7 customer health', () => {
  it('scores a workspace with factors, risks and recommendations', async () => {
    const report = await customerHealthService.evaluate(workspaceId);
    expect(report.workspaceId).toBe(workspaceId);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(['healthy', 'watch', 'at_risk']).toContain(report.band);
    expect(report.factors.length).toBeGreaterThan(0);
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(report.signals.workflows).toBeGreaterThanOrEqual(0);
  });

  it('rolls the portfolio up for the operator console', async () => {
    const portfolio = await customerHealthService.portfolio({ limit: 10 });
    expect(portfolio.summary.total).toBeGreaterThan(0);
    expect(portfolio.customers[0]?.workspaceId).toBeTruthy();
    expect(portfolio.summary.healthy + portfolio.summary.watch + portfolio.summary.atRisk)
      .toBe(portfolio.customers.length);
  });
});

describe('Phase 14 public go-to-market endpoints', () => {
  it('serves the sellable catalog and plan comparison', async () => {
    const plans = await request.get('/api/v1/marketing/plans').expect(200);
    expect(plans.body.plans).toHaveLength(3);
    expect(plans.body.freeTier.packageId).toBeNull();
    expect(plans.body.aliases.BUSINESS).toBe('PROFESSIONAL');

    const compare = await request
      .get('/api/v1/marketing/plans/compare')
      .query({ from: 'STARTER', to: 'BUSINESS' })
      .expect(200);
    expect(compare.body.upgrade).toBe(true);

    await request.get('/api/v1/marketing/plans/compare').expect(400);
  });

  it('captures leads from the website and records funnel events', async () => {
    const created = await request.post('/api/v1/marketing/leads').send({
      company: 'Globex',
      contactName: 'Hank Scorpio',
      contactEmail: 'hank@globex.test',
      interest: 'ENTERPRISE',
      source: 'DEMO_REQUEST',
      message: 'Interested in a governed deployment',
    }).expect(201);
    expect(created.body.lead.company).toBe('Globex');
    expect(created.body.duplicate).toBe(false);

    await request.post('/api/v1/marketing/leads').send({ company: 'x' }).expect(400);

    const event = await request.post('/api/v1/marketing/events').send({
      event: 'LANDING_VIEW', source: 'paid', anonymousId: 'anon-test',
    }).expect(202);
    expect(event.body.recorded).toBe(true);

    await request.post('/api/v1/marketing/events').send({ event: 'SUBSCRIPTION_STARTED' }).expect(400);
  });

  it('serves the solution catalog publicly and requires auth to install', async () => {
    const list = await request.get('/api/v1/solutions').expect(200);
    expect(list.body.solutions.length).toBeGreaterThan(0);
    const solutionId = list.body.solutions[0].id;

    const detail = await request.get(`/api/v1/solutions/${solutionId}`).expect(200);
    expect(detail.body.id).toBe(solutionId);

    await request.get('/api/v1/solutions/unknown-solution').expect(404);
    await request.post(`/api/v1/solutions/${solutionId}/install`).send({}).expect(401);
  });
});

describe('Phase 14 operator and customer endpoints', () => {
  it('restricts the sales console to platform administrators', async () => {
    await request.get('/api/v1/sales/leads').expect(401);
    await request.get('/api/v1/sales/leads').set('Authorization', 'Bearer invalid').expect(401);

    const leads = await authed(request.get('/api/v1/sales/leads')).expect(200);
    expect(Array.isArray(leads.body.leads)).toBe(true);
    expect(leads.body.pipeline.totals.leads).toBeGreaterThan(0);

    const deniedEmail = process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await authed(request.get('/api/v1/sales/leads')).expect(403);
    process.env.PLATFORM_ADMIN_EMAILS = deniedEmail;

    const funnel = await authed(request.get('/api/v1/sales/funnel')).query({ days: 7 }).expect(200);
    expect(funnel.body.steps.length).toBeGreaterThan(0);

    const pipeline = await authed(request.get('/api/v1/sales/leads/pipeline')).expect(200);
    expect(pipeline.body.totals.leads).toBeGreaterThan(0);
  });

  it('lets sales update a lead and create its demo workspace', async () => {
    const lead = await LeadModel.findOne({ contactEmail: 'hank@globex.test' });
    const leadId = lead!._id.toString();

    const updated = await authed(request.patch(`/api/v1/sales/leads/${leadId}`))
      .send({ status: 'CONTACTED', note: 'Intro call booked', markContacted: true })
      .expect(200);
    expect(updated.body.status).toBe('CONTACTED');

    const demo = await authed(request.post(`/api/v1/sales/leads/${leadId}/demo`))
      .send({ ttlHours: 24 })
      .expect(201);
    expect(demo.body.demo.workspaceId).toBeTruthy();
    expect(demo.body.lead.demoWorkspaceId).toBe(demo.body.demo.workspaceId);

    const reloaded = await LeadModel.findById(leadId);
    expect(reloaded?.demoStatus).toBe('CREATED');
  });
});

describe('Phase 14 customer entitlement and checkout endpoints', () => {
  it('serves the workspace entitlement summary to members', async () => {
    await request.get('/api/v1/entitlements').expect(401);

    const summary = await scoped(request.get('/api/v1/entitlements')).expect(200);
    expect(summary.body.workspaceId).toBe(workspaceId);
    expect(summary.body.plan).toBe('FREE');
    expect(summary.body.features.length).toBeGreaterThan(0);

    const feature = await scoped(request.get('/api/v1/entitlements/SSO')).expect(200);
    expect(feature.body.feature).toBe('SSO');
    expect(feature.body.requiredPlan).toBe('ENTERPRISE');

    await scoped(request.get('/api/v1/entitlements/NOT_A_FEATURE')).expect(400);
  });

  it('verifies a checkout payment through the workspace provider', async () => {
    await request.post('/api/v1/billing/checkout/verify').send({ paymentId: 'pay_test' }).expect(401);

    const verified = await scoped(request.post('/api/v1/billing/checkout/verify'))
      .send({ paymentId: 'pay_test_123', packageId: 'STARTER' })
      .expect(200);
    expect(verified.body.payment.id).toBe('pay_test_123');
    expect(verified.body.activated).toBe(true);
    expect(verified.body.subscription.plan).toBe('STARTER');
    expect(verified.body.entitlements.plan).toBe('STARTER');

    await scoped(request.post('/api/v1/billing/checkout/verify')).send({}).expect(400);
  });

  it('gates manual invoice creation behind the platform admin allowlist', async () => {
    await authed(request.post('/api/v1/billing/invoices')).send({}).expect(400);

    const deniedEmail = process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await authed(request.post('/api/v1/billing/invoices')).send({ customerId: 'cus_missing' }).expect(403);
    process.env.PLATFORM_ADMIN_EMAILS = deniedEmail;
  });
});

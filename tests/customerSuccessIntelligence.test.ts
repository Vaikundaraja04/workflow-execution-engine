import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { EnterpriseAccountModel } from '../src/models/EnterpriseAccountModel.js';
import { SupportTicketModel } from '../src/models/SupportTicketModel.js';
import { UsageMeterModel } from '../src/models/UsageMeterModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkspaceUsageModel } from '../src/models/WorkspaceUsageModel.js';
import { monthPeriodKey } from '../src/services/usageMeteringService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 18.2 - Customer success intelligence through the app: one workspace
 * scored from recorded usage, adoption, activity and support pressure, the
 * portfolio with status filters, the enterprise account join and tenant-scoped
 * member access.
 */

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-success-intelligence-18',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'intel-admin@acme.test';
const healthyEmail = 'intel-healthy@acme.test';
const riskyEmail = 'intel-risky@acme.test';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let adminToken = '';
let healthyToken = '';
let adminUserId = '';
let healthyWorkspaceId = '';
let riskyWorkspaceId = '';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({
    auth: authConfig,
    docs: false,
    health: {
      checks: {
        mongo: async () => ({ status: 'up', latencyMs: 1 }),
        redis: async () => ({ status: 'skipped', latencyMs: 0 }),
        worker: async () => ({ status: 'skipped', latencyMs: 0 }),
      },
    },
  }));

  const admin = await request.post('/api/v1/saas/signup').send({
    email: adminEmail,
    password: 'IntelPass123!',
    name: 'Intelligence Admin',
    companyName: 'Intelligence Platform',
  });
  adminToken = admin.body.tokens.accessToken;
  adminUserId = admin.body.user.id;

  const healthy = await request.post('/api/v1/saas/signup').send({
    email: healthyEmail,
    password: 'IntelPass123!',
    name: 'Healthy Owner',
    companyName: 'Healthy Manufacturing',
  });
  healthyToken = healthy.body.tokens.accessToken;
  healthyWorkspaceId = healthy.body.workspace.id;

  const risky = await request.post('/api/v1/saas/signup').send({
    email: riskyEmail,
    password: 'IntelPass123!',
    name: 'Risky Owner',
    companyName: 'Risky Retail',
  });
  riskyWorkspaceId = risky.body.workspace.id;
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await Promise.all([
    WorkspaceUsageModel.deleteMany({}),
    UsageMeterModel.deleteMany({}),
    SupportTicketModel.deleteMany({}),
    EnterpriseAccountModel.deleteMany({}),
  ]);
});

async function seedUsage(
  workspaceId: string,
  values: { workflows: number; monthlyExecutions: number; totalExecutions: number; successRate: number },
) {
  await WorkspaceUsageModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    totalWorkflows: values.workflows,
    totalExecutions: values.totalExecutions,
    successfulExecutions: Math.round(values.totalExecutions * values.successRate),
    monthlyExecutions: values.monthlyExecutions,
    monthKey: monthPeriodKey(new Date()),
    successRate: values.successRate,
    averageExecutionTime: 1200,
    storageUsed: 1024,
  });
}

async function seedAiTokens(workspaceId: string, tokens: number) {
  await UsageMeterModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    metric: 'AI_TOKENS',
    granularity: 'MONTH',
    periodKey: monthPeriodKey(new Date()),
    value: tokens,
    limit: null,
    percent: 0,
    alertState: 'OK',
  });
}

function ticketNumber(): string {
  return `TCK-${new Types.ObjectId().toHexString().slice(-8).toUpperCase()}`;
}

async function seedTickets(workspaceId: string, total: number, breached: number) {
  for (let index = 0; index < total; index += 1) {
    const isBreached = index < breached;
    await SupportTicketModel.create({
      ticketNumber: ticketNumber(),
      workspaceId: new Types.ObjectId(workspaceId),
      subject: `Support request ${index + 1}`,
      description: 'Recorded support pressure for the intelligence score.',
      category: 'TECHNICAL',
      priority: 'NORMAL',
      status: 'OPEN',
      createdBy: new Types.ObjectId(adminUserId),
      assigneeId: null,
      slaPolicyId: null,
      firstResponseDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      resolutionDueAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      firstResponseAt: null,
      resolvedAt: null,
      resolution: null,
      escalationLevel: isBreached ? 1 : 0,
      breached: isBreached,
      breachNotifiedAt: isBreached ? new Date() : null,
      tags: [],
    });
  }
}

async function makeMemberActive(workspaceId: string, active: boolean) {
  await WorkspaceMemberModel.updateMany(
    { workspaceId: new Types.ObjectId(workspaceId), status: 'ACTIVE' },
    { $set: { lastActiveAt: active ? new Date() : null } },
  );
}

async function seedHealthyWorkspace() {
  await seedUsage(healthyWorkspaceId, {
    workflows: 6,
    monthlyExecutions: 150,
    totalExecutions: 200,
    successRate: 0.98,
  });
  await seedAiTokens(healthyWorkspaceId, 50000);
  await makeMemberActive(healthyWorkspaceId, true);
}

async function seedRiskyWorkspace() {
  await makeMemberActive(riskyWorkspaceId, false);
  await seedTickets(riskyWorkspaceId, 3, 2);
}

describe('Phase 18.2 scoring one workspace', () => {
  it('marks a healthy workspace and joins its enterprise account', async () => {
    await seedHealthyWorkspace();
    const account = await request
      .post('/api/v1/accounts')
      .set(bearer(adminToken))
      .send({
        workspaceId: healthyWorkspaceId,
        company: 'Healthy Co',
        accountOwnerId: adminUserId,
        customerStatus: 'ACTIVE',
      });
    expect(account.status).toBe(201);

    const res = await request
      .get(`/api/v1/customer-success/health?workspaceId=${healthyWorkspaceId}`)
      .set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('HEALTHY');
    expect(res.body.data.score).toBeGreaterThanOrEqual(70);
    expect(res.body.data.companyName).toBe('Healthy Manufacturing');
    expect(res.body.data.account).toMatchObject({ company: 'Healthy Co', customerStatus: 'ACTIVE' });
    expect(res.body.data.signals).toMatchObject({ workflows: 6, monthlyExecutions: 150, tokensThisMonth: 50000 });
    expect(res.body.data.components).toHaveLength(5);
    const weight = res.body.data.components.reduce(
      (sum: number, component: { weight: number }) => sum + component.weight,
      0,
    );
    expect(weight).toBe(100);
    expect(res.body.data.risks.map((risk: { code: string }) => risk.code)).not.toContain('SLA_BREACHES');
  });
});

describe('Phase 18.2 risk detection', () => {
  it('flags a critical workspace with risks and recommendations', async () => {
    await seedRiskyWorkspace();

    const res = await request
      .get(`/api/v1/customer-success/health?workspaceId=${riskyWorkspaceId}`)
      .set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CRITICAL');
    expect(res.body.data.score).toBeLessThan(40);
    expect(res.body.data.account).toBeNull();

    const riskCodes = res.body.data.risks.map((risk: { code: string }) => risk.code);
    expect(riskCodes).toContain('LOW_USAGE');
    expect(riskCodes).toContain('LOW_TEAM_ACTIVITY');
    expect(riskCodes).toContain('SLA_BREACHES');

    const recommendationCodes = res.body.data.recommendations.map(
      (recommendation: { code: string }) => recommendation.code,
    );
    expect(recommendationCodes).toContain('RESOLVE_TICKETS');
    expect(recommendationCodes).toContain('INVITE_TEAM');
    const resolve = res.body.data.recommendations.find(
      (recommendation: { code: string }) => recommendation.code === 'RESOLVE_TICKETS',
    );
    expect(resolve.priority).toBe('HIGH');

    const support = res.body.data.components.find((component: { key: string }) => component.key === 'support');
    expect(support.score).toBe(0);
    expect(support.detail).toContain('3 open ticket(s), 2 breached');
  });
});

describe('Phase 18.2 the portfolio', () => {
  it('folds the book and filters by status', async () => {
    await seedHealthyWorkspace();
    await seedRiskyWorkspace();

    const portfolio = await request.get('/api/v1/customer-success/health').set(bearer(adminToken));
    expect(portfolio.status).toBe(200);
    expect(portfolio.body.data.summary.total).toBeGreaterThanOrEqual(2);
    expect(portfolio.body.data.summary.healthy).toBeGreaterThanOrEqual(1);
    expect(portfolio.body.data.summary.critical).toBeGreaterThanOrEqual(1);
    const workspaceIds = portfolio.body.data.accounts.map((account: { workspaceId: string }) => account.workspaceId);
    expect(workspaceIds).toContain(healthyWorkspaceId);
    expect(workspaceIds).toContain(riskyWorkspaceId);

    const criticalOnly = await request
      .get('/api/v1/customer-success/health?status=CRITICAL')
      .set(bearer(adminToken));
    expect(criticalOnly.body.data.accounts.length).toBeGreaterThanOrEqual(1);
    expect(
      criticalOnly.body.data.accounts.every((account: { status: string }) => account.status === 'CRITICAL'),
    ).toBe(true);
  });
});

describe('Phase 18.2 success intelligence access control', () => {
  it('lets members read only their own workspace', async () => {
    const own = await request.get('/api/v1/customer-success/health').set(bearer(healthyToken));
    expect(own.status).toBe(200);
    expect(own.body.data.workspaceId).toBe(healthyWorkspaceId);

    const ownById = await request
      .get(`/api/v1/customer-success/health?workspaceId=${healthyWorkspaceId}`)
      .set(bearer(healthyToken));
    expect(ownById.status).toBe(200);

    const foreign = await request
      .get(`/api/v1/customer-success/health?workspaceId=${riskyWorkspaceId}`)
      .set(bearer(healthyToken));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('WORKSPACE_NOT_FOUND');

    await request.get('/api/v1/customer-success/health').expect(401);
  });
});

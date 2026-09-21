import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { TenantAccountModel } from '../src/models/TenantAccountModel.js';
import { CustomerProfileModel } from '../src/models/CustomerProfileModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-saas-onboarding-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

let signupResult: any;

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
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);
describe('SaaS onboarding', () => {
  it('creates the full tenant on signup with a configured trial', async () => {
    const res = await request
      .post('/api/v1/saas/signup')
      .send({
        email: 'founder@acme.test',
        password: 'FounderPass123!',
        name: 'Ada Founder',
        companyName: 'Acme Automation',
        useCase: 'operations',
      })
      .expect(201);

    signupResult = res.body;
    expect(res.body.user.email).toBe('founder@acme.test');
    expect(res.body.tenant.status).toBe('TRIALING');
    expect(res.body.tokens.accessToken).toBeTruthy();

    const workspace = await WorkspaceModel.findById(res.body.workspace.id);
    expect(workspace).toBeTruthy();

    const membership = await WorkspaceMemberModel.findOne({
      workspaceId: workspace!._id,
      role: 'OWNER',
      status: 'ACTIVE',
    });
    expect(membership).toBeTruthy();

    const tenant = await TenantAccountModel.findOne({ workspaceId: workspace!._id });
    expect(tenant?.status).toBe('TRIALING');
    expect(tenant?.trialEndsAt).toBeTruthy();
    expect(tenant?.demo).toBe(false);

    const profile = await CustomerProfileModel.findOne({ tenantId: workspace!._id });
    expect(profile?.contactEmail).toBe('founder@acme.test');
    expect(profile?.company).toBe('Acme Automation');

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspace!._id });
    expect(subscription?.status).toBe('TRIALING');
    expect(subscription?.trialEndsAt).toBeTruthy();

    const workflows = await WorkflowModel.find({ workspaceId: workspace!._id });
    expect(workflows.length).toBe(res.body.starterWorkflowIds.length);
    expect(workflows.length).toBeGreaterThan(0);

    const audit = await AuditLogModel.findOne({
      action: 'SAAS_SIGNUP_COMPLETED',
      workspaceId: workspace!._id,
    });
    expect(audit).toBeTruthy();
  });

  it('rejects duplicate emails with 409', async () => {
    await request
      .post('/api/v1/saas/signup')
      .send({
        email: 'founder@acme.test',
        password: 'AnotherPass123!',
        name: 'Ada Again',
        companyName: 'Acme Automation',
      })
      .expect(409);
  });
  it('records onboarding progress and completion', async () => {
    const auth = { Authorization: `Bearer ${signupResult.tokens.accessToken}` };
    const workspaceId = signupResult.workspace.id;

    const progress = await request
      .post('/api/v1/saas/onboarding')
      .set(auth)
      .set('x-workspace-id', workspaceId)
      .send({ steps: ['company', 'use_case'] })
      .expect(200);
    expect(progress.body.steps).toEqual(['company', 'use_case']);
    expect(progress.body.completed).toBe(false);

    const completed = await request
      .post('/api/v1/saas/onboarding')
      .set(auth)
      .set('x-workspace-id', workspaceId)
      .send({ steps: ['company', 'use_case', 'templates'], completed: true })
      .expect(200);
    expect(completed.body.completed).toBe(true);
    expect(completed.body.completedAt).toBeTruthy();

    const audit = await AuditLogModel.findOne({ action: 'SAAS_ONBOARDING_COMPLETED' });
    expect(audit).toBeTruthy();
  });

  it('returns the account snapshot to members and hides it from outsiders', async () => {
    const auth = { Authorization: `Bearer ${signupResult.tokens.accessToken}` };
    const workspaceId = signupResult.workspace.id;

    const account = await request
      .get('/api/v1/saas/account')
      .set(auth)
      .set('x-workspace-id', workspaceId)
      .expect(200);

    expect(account.body.tenant.companyName).toBe('Acme Automation');
    expect(account.body.subscription.plan).toBe('FREE');
    expect(account.body.profile.contactEmail).toBe('founder@acme.test');
    expect(account.body.usage.metrics).toHaveLength(5);

    const outsider = await UserModel.create({
      email: 'outsider@other.test',
      passwordHash: 'unused-test-password-hash',
    });
    const outsiderToken = signAccessToken(authConfig, {
      userId: outsider._id.toString(),
      email: outsider.email,
    });
    await request
      .get('/api/v1/saas/account')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('x-workspace-id', workspaceId)
      .expect(404);
  });

  it('validates the signup payload', async () => {
    await request
      .post('/api/v1/saas/signup')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);
  });
});

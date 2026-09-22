import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { TenantAccountModel } from '../src/models/TenantAccountModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { ConversionEventModel } from '../src/models/ConversionEventModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { onboardingService, INDUSTRY_SOLUTION_MAP } from '../src/services/onboardingService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 15.5 - Customer onboarding wizard.
 *
 * Step state, step completion through the existing services, audit entries and
 * the completion gate.
 */

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-onboarding-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const ownerEmail = 'onboarding-owner@acme.test';
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
    name: 'Onboarding Owner',
    companyName: 'Onboarding Co',
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

describe('Phase 15.5 onboarding wizard', () => {
  it('reports an unstarted wizard', async () => {
    const response = await scoped(request.get('/api/v1/onboarding/status'));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ONBOARDING_NOT_STARTED');
  });

  it('starts the wizard and completes the workspace step', async () => {
    const response = await scoped(request.post('/api/v1/onboarding/start'));
    expect(response.status).toBe(201);
    const session = response.body.session;
    expect(response.body.created).toBe(true);
    expect(session.completedSteps).toContain('create_workspace');
    expect(session.currentStep).toBe('select_industry');
    expect(session.status).toBe('IN_PROGRESS');
    expect(session.steps).toHaveLength(5);
    const current = session.steps.find((step: { status: string }) => step.status === 'CURRENT');
    expect(current.step).toBe('select_industry');

    const audit = await AuditLogModel.findOne({ action: 'ONBOARDING_STARTED', workspaceId });
    expect(audit).not.toBeNull();
  });

  it('resumes instead of restarting an existing session', async () => {
    const response = await scoped(request.post('/api/v1/onboarding/start'));
    expect(response.status).toBe(200);
    expect(response.body.created).toBe(false);
  });

  it('rejects an unknown industry', async () => {
    const response = await scoped(request.post('/api/v1/onboarding/industry')).send({
      industry: 'Space Travel',
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('records the industry and resolves the recommended solution', async () => {
    const response = await scoped(request.post('/api/v1/onboarding/industry')).send({
      industry: 'Retail',
    });
    expect(response.status).toBe(200);
    expect(response.body.selectedIndustry).toBe('Retail');
    expect(response.body.selectedSolution).toBe(INDUSTRY_SOLUTION_MAP.Retail);
    expect(response.body.completedSteps).toContain('select_industry');
    expect(response.body.currentStep).toBe('install_solution');
  });
  it('installs the recommended solution through the existing service', async () => {
    const response = await scoped(request.post('/api/v1/onboarding/solution')).send({});
    expect(response.status).toBe(200);
    expect(response.body.installed.solutionId).toBe(INDUSTRY_SOLUTION_MAP.Retail);
    expect(response.body.progress.completedSteps).toContain('install_solution');
    expect(response.body.progress.currentStep).toBe('create_workflow');
  });

  it('creates the first workflow through the workflow service', async () => {
    const response = await scoped(request.post('/api/v1/onboarding/workflow')).send({
      name: 'First automation',
    });
    expect(response.status).toBe(201);
    expect(response.body.workflowId).toBeTruthy();
    expect(response.body.progress.completedSteps).toContain('create_workflow');

    const workflow = await WorkflowModel.findById(response.body.workflowId).lean();
    expect(workflow?.name).toBe('First automation');
    expect(workflow?.workspaceId?.toString()).toBe(workspaceId);
  });
  it('invites the first teammate through the member service', async () => {
    // Invitations resolve to a registered user, so the teammate signs up first.
    await request.post('/api/v1/saas/signup').send({
      email: 'teammate@acme.test',
      password: 'FounderPass123!',
      name: 'Teammate',
      companyName: 'Teammate Co',
    });
    const response = await scoped(request.post('/api/v1/onboarding/invite')).send({
      email: 'Teammate@Acme.test',
      role: 'EDITOR',
    });
    expect(response.status).toBe(201);
    expect(response.body.memberId).toBeTruthy();
    expect(response.body.progress.completedSteps).toContain('invite_team');
  });

  it('refuses to skip a required step', async () => {
    const actorId = new mongoose.Types.ObjectId().toString();
    await expect(onboardingService.skipStep(workspaceId, actorId, 'select_industry'))
      .rejects.toThrow('ONBOARDING_STEP_REQUIRED');
  });
  it('completes the wizard, syncs the tenant record and records the funnel event', async () => {
    const response = await scoped(request.post('/api/v1/onboarding/complete'));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.completedAt).toBeTruthy();

    const audit = await AuditLogModel.findOne({ action: 'ONBOARDING_COMPLETED', workspaceId });
    expect(audit?.metadata?.solution).toBe(INDUSTRY_SOLUTION_MAP.Retail);

    const tenant = await TenantAccountModel.findOne({ workspaceId }).lean();
    expect(tenant?.onboarding.completed).toBe(true);
    expect(tenant?.onboarding.completedAt).toBeTruthy();

    const conversion = await ConversionEventModel.findOne({
      event: 'SIGNUP_COMPLETED',
      workspaceId,
    }).lean();
    expect(conversion).not.toBeNull();
  });
});
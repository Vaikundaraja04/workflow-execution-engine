import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { ConversionEventModel } from '../src/models/ConversionEventModel.js';
import { DemoScenarioModel } from '../src/models/DemoScenarioModel.js';
import { GrowthEventModel } from '../src/models/GrowthEventModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-demo-scenarios',
  accessTtl: '15m',
  refreshTtl: '7d',
};

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

describe('Phase 16.3 demo scenario platform', () => {
  it('serves the curated scenario catalog with real solution content', async () => {
    const res = await request.get('/api/v1/demo/scenarios').expect(200);
    expect(res.body.scenarios).toHaveLength(5);
    expect(res.body.scenarios.map((scenario: { id: string }) => scenario.id).sort()).toEqual([
      'customer-support', 'finance-approval', 'hr-automation', 'it-helpdesk', 'sales-automation',
    ]);
    const helpdesk = res.body.scenarios.find((scenario: { id: string }) => scenario.id === 'it-helpdesk');
    expect(helpdesk.workflowCount).toBeGreaterThan(0);
    expect(helpdesk.workflows.length).toBeGreaterThan(0);
    expect(helpdesk.sampleRuns.length).toBeGreaterThan(0);
    expect(helpdesk.talkTrack.length).toBeGreaterThan(0);
    expect(await DemoScenarioModel.countDocuments()).toBe(5);
  });

  it('returns one scenario and hides unknown ids', async () => {
    const res = await request.get('/api/v1/demo/scenarios/finance-approval').expect(200);
    expect(res.body.persona).toBeTruthy();
    expect(res.body.explanation).toBeTruthy();
    expect(res.body.solutionId).toBeTruthy();
    const missing = await request.get('/api/v1/demo/scenarios/not-a-scenario').expect(404);
    expect(missing.body.error.code).toBe('DEMO_SCENARIO_NOT_FOUND');
  });

  it('starts a sandbox, installs the solution and records the lifecycle events', async () => {
    const res = await request.post('/api/v1/demo/start/it-helpdesk').expect(201);
    expect(res.body.scenario.id).toBe('it-helpdesk');
    expect(res.body.demo.workspaceId).toBeTruthy();
    expect(res.body.demo.tokens.accessToken).toBeTruthy();
    expect(res.body.demo.tokens.refreshToken).toBeTruthy();
    expect(res.body.install.workflowIds.length).toBeGreaterThan(0);
    expect(res.body.nextSteps.length).toBeGreaterThan(0);

    const workflows = await WorkflowModel.countDocuments({ workspaceId: new mongoose.Types.ObjectId(res.body.demo.workspaceId) });
    expect(workflows).toBeGreaterThan(0);
    expect(await AuditLogModel.countDocuments({ action: 'DEMO_SCENARIO_STARTED', resourceId: 'it-helpdesk' })).toBe(1);
    expect(await GrowthEventModel.countDocuments({ event: 'DEMO_STARTED', source: 'DEMO_SCENARIO' })).toBe(1);
    expect(await ConversionEventModel.countDocuments({ event: 'DEMO_CREATED' })).toBeGreaterThanOrEqual(1);
  }, 60000);

  it('rejects unknown scenarios at start', async () => {
    const res = await request.post('/api/v1/demo/start/not-a-scenario').expect(404);
    expect(res.body.error.code).toBe('DEMO_SCENARIO_NOT_FOUND');
  });
});

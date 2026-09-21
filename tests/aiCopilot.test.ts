import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { AICopilotService } from '../src/services/aiCopilotService.js';
import { NodeCapabilityRegistry } from '../src/services/ai/nodeCapabilityRegistry.js';
import { AIProviderFactory } from '../src/services/ai/AIProviderFactory.js';
import { MockAIProvider } from '../src/services/ai/MockAIProvider.js';
import { AIUsageService } from '../src/services/aiUsageService.js';
import { CopilotSessionModel } from '../src/models/CopilotSessionModel.js';
import { CopilotMessageModel } from '../src/models/CopilotMessageModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import * as auditService from '../src/services/auditService.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(
    createApp({
      auth: authConfig,
      authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
    }),
  );
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

const workspaceId = new Types.ObjectId();
const userId = new Types.ObjectId();

beforeEach(async () => {
  vi.restoreAllMocks();
  AIProviderFactory.resetMockProvider();
  await CopilotSessionModel.deleteMany({});
  await CopilotMessageModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await UserModel.deleteMany({});
  vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as never);
  vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as never);
});

describe('NodeCapabilityRegistry', () => {
  it('lists supported node capabilities', () => {
    const registry = NodeCapabilityRegistry.getInstance();
    expect(registry.listTypes()).toEqual(expect.arrayContaining(['webhook', 'condition', 'log']));
  });

  it('provides AI-safe descriptions, schemas, permissions, and risk levels', () => {
    const registry = NodeCapabilityRegistry.getInstance();
    const webhook = registry.getCapability('webhook');
    expect(webhook?.aiDescription).toMatch(/webhook/i);
    expect(webhook?.requiredPermissions).toContain('WORKFLOW_CREATE');
    expect(webhook?.riskLevel).toBe('LOW');
    expect(registry.getJsonSchema('condition')).toMatchObject({ type: 'object' });
    expect(registry.maxRiskLevel(['webhook', 'condition'])).toBe('MEDIUM');
    expect(registry.requiredPermissions(['webhook'])).toContain('WORKFLOW_EXECUTE');
    expect(registry.isSupported('nope')).toBe(false);
  });

  it('builds repair context from validation errors', () => {
    const registry = NodeCapabilityRegistry.getInstance();
    const context = registry.buildRepairContext([
      { type: 'DUPLICATE_NODE', message: 'Duplicate node ID: node_1', nodeId: 'node_1' },
    ]);
    expect(context).toMatch(/Duplicate node ID/);
    expect(context).toMatch(/Node capability registry/);
  });
});


describe('AICopilotService intent routing', () => {
  it('classifies all four intents', () => {
    const service = AICopilotService.getInstance();
    expect(service.classifyIntent('Please build me an onboarding workflow')).toBe('BUILD_WORKFLOW');
    expect(service.classifyIntent('Please modify the draft to add an approval step')).toBe('MODIFY_WORKFLOW');
    expect(service.classifyIntent('Can you explain how this workflow runs?')).toBe('EXPLAIN_WORKFLOW');
    expect(service.classifyIntent('Please validate this workflow for errors')).toBe('VALIDATE_WORKFLOW');
  });

  it('creates a session and stores messages', async () => {
    const service = AICopilotService.getInstance();
    const session = await service.createSession(workspaceId, userId, { title: 'Onboarding help' });
    expect(session.id).toBeDefined();
    expect(session.title).toBe('Onboarding help');

    const stored = await service.appendMessage({
      sessionId: session.id,
      workspaceId,
      userId,
      role: 'user',
      content: 'hello',
      intent: 'EXPLAIN_WORKFLOW',
    });
    expect(stored.content).toBe('hello');

    const fetched = await service.getSession(session.id, workspaceId);
    expect(fetched?.session.id).toBe(session.id);
    expect(fetched?.messages.length).toBe(1);
  });

  it('BUILD routes through workflow generation with a draft artifact', async () => {
    const provider = new MockAIProvider();
    vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
      provider, model: 'mock-model', providerName: 'mock',
    });
    const service = AICopilotService.getInstance();
    const session = await service.createSession(workspaceId, userId);

    const result = await service.processMessage({
      sessionId: session.id, workspaceId, userId, content: 'Build an employee onboarding workflow',
    });

    expect(result.intent).toBe('BUILD_WORKFLOW');
    expect(result.response?.artifacts.some((a) => a.kind === 'DRAFT_WORKFLOW')).toBe(true);
    expect(result.response?.status).toBe('COMPLETED');
  });

  it('MODIFY without a draft returns guidance instead of a plan', async () => {
    const service = AICopilotService.getInstance();
    const session = await service.createSession(workspaceId, userId);
    const result = await service.processMessage({
      sessionId: session.id, workspaceId, userId, content: 'Modify the draft to add an approval step',
    });
    expect(result.intent).toBe('MODIFY_WORKFLOW');
    expect(result.response?.status).toBe('NEEDS_REVIEW');
    expect(result.response?.content).toMatch(/No draft workflow/);
  });

  it('MODIFY with a draft produces a change plan', async () => {
    const provider = new MockAIProvider();
    vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
      provider, model: 'mock-model', providerName: 'mock',
    });
    const service = AICopilotService.getInstance();
    const session = await service.createSession(workspaceId, userId);
    await service.processMessage({
      sessionId: session.id, workspaceId, userId, content: 'Build an employee onboarding workflow',
    });
    const result = await service.processMessage({
      sessionId: session.id, workspaceId, userId, content: 'Modify the draft to add an approval step',
    });
    expect(result.intent).toBe('MODIFY_WORKFLOW');
    expect(result.response?.artifacts.some((a) => a.kind === 'CHANGE_PLAN')).toBe(true);
  });
});

describe('AICopilotService explain and validate', () => {
  it('EXPLAIN describes a stored workflow', async () => {
    const workflow = await WorkflowModel.create({
      name: 'Explain me',
      ownerId: userId,
      workspaceId,
      draftDefinition: {
        nodes: [
          { id: 'webhook_1', type: 'webhook', config: {} },
          { id: 'log_1', type: 'log', config: { message: 'done' } },
        ],
        edges: [{ source: 'webhook_1', target: 'log_1' }],
      },
      status: 'DRAFT',
      latestVersionNumber: 0,
    });
    const service = AICopilotService.getInstance();
    const session = await service.createSession(workspaceId, userId);
    const result = await service.processMessage({
      sessionId: session.id, workspaceId, userId,
      content: `Explain how workflow ${(workflow._id as Types.ObjectId).toString()} works`,
    });
    expect(result.intent).toBe('EXPLAIN_WORKFLOW');
    expect(result.response?.artifacts.some((a) => a.kind === 'EXPLANATION')).toBe(true);
  });

  it('VALIDATE reports graph errors for a stored workflow', async () => {
    const workflow = await WorkflowModel.create({
      name: 'Broken',
      ownerId: userId,
      workspaceId,
      draftDefinition: {
        nodes: [
          { id: 'node_1', type: 'webhook', config: {} },
          { id: 'node_1', type: 'log', config: { message: 'dup' } },
        ],
        edges: [],
      },
      status: 'DRAFT',
      latestVersionNumber: 0,
    });
    const service = AICopilotService.getInstance();
    const session = await service.createSession(workspaceId, userId);
    const result = await service.processMessage({
      sessionId: session.id, workspaceId, userId,
      content: `Validate workflow ${(workflow._id as Types.ObjectId).toString()} for errors`,
    });
    expect(result.intent).toBe('VALIDATE_WORKFLOW');
    const report = result.response?.artifacts.find((a) => a.kind === 'VALIDATION_REPORT');
    expect(report).toBeDefined();
    expect((report?.data as { isValid: boolean }).isValid).toBe(false);
  });
});


describe('Auto repair loop', () => {
  it('retries invalid drafts with registry context and caps at 3 attempts', async () => {
    const invalid = {
      workflowName: 'Broken', description: 'broken',
      nodes: [
        { id: 'node_1', type: 'webhook', config: {} },
        { id: 'node_1', type: 'log', config: { message: 'dup' } },
      ],
      connections: [],
    };
    const valid = {
      workflowName: 'Fixed', description: 'fixed',
      nodes: [
        { id: 'webhook_1', type: 'webhook', config: {} },
        { id: 'log_1', type: 'log', config: { message: 'ok' } },
      ],
      connections: [{ source: 'webhook_1', target: 'log_1' }],
    };
    const provider = new MockAIProvider();
    const spy = vi.spyOn(provider, 'generateWorkflow')
      .mockResolvedValueOnce(invalid as never)
      .mockResolvedValueOnce(invalid as never)
      .mockResolvedValue(valid as never);
    vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
      provider, model: 'mock-model', providerName: 'mock',
    });

    const result = await AICopilotService.getInstance().generateDraftWithRepair(
      workspaceId, userId, 'Build a simple workflow',
    );

    expect(result.validation.isValid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.repairAttempts.length).toBe(2);
    expect(spy).toHaveBeenCalledTimes(3);
    const retryPrompt = String(spy.mock.calls[1]?.[0] ?? '');
    expect(retryPrompt).toMatch(/validation/i);
  });

  it('returns REPAIR_EXHAUSTED after 3 failed retries', async () => {
    const invalid = {
      workflowName: 'Broken', description: 'broken',
      nodes: [{ id: 'node_1', type: 'invalid_node_type', config: {} }],
      connections: [],
    };
    const provider = new MockAIProvider();
    vi.spyOn(provider, 'generateWorkflow').mockResolvedValue(invalid as never);
    vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
      provider, model: 'mock-model', providerName: 'mock',
    });

    const repair = await AICopilotService.getInstance().generateDraftWithRepair(
      workspaceId, userId, 'Build a broken workflow',
    );
    expect(repair.validation.isValid).toBe(false);
    expect(repair.repairAttempts.length).toBe(3);

    const service = AICopilotService.getInstance();
    const session = await service.createSession(workspaceId, userId);
    const result = await service.processMessage({
      sessionId: session.id, workspaceId, userId,
      content: 'Build a broken workflow',
    });
    expect(result.response?.status).toBe('REPAIR_EXHAUSTED');
    expect(result.response?.repairAttempts.length).toBe(3);
  });
});


describe('Copilot API RBAC', () => {
  async function setupFixture() {
    const owner = await UserModel.create({ email: 'copilot-owner@test.dev', passwordHash: 'x' });
    const editor = await UserModel.create({ email: 'copilot-editor@test.dev', passwordHash: 'x' });
    const viewer = await UserModel.create({ email: 'copilot-viewer@test.dev', passwordHash: 'x' });
    const workspace = await WorkspaceModel.create({
      name: 'Copilot WS',
      slug: `copilot-${new Types.ObjectId().toString()}`,
      ownerId: owner._id,
      status: 'ACTIVE',
    });
    const workspaceIdStr = workspace._id.toString();
    for (const [user, role] of [[owner, 'OWNER'], [editor, 'EDITOR'], [viewer, 'VIEWER']] as const) {
      await WorkspaceMemberModel.create({
        workspaceId: workspace._id,
        userId: user._id,
        role,
        status: 'ACTIVE',
        permissions: permissionsForRole(role),
      });
    }
    const tokenFor = (user: { _id: Types.ObjectId; email: string }) =>
      signAccessToken(authConfig, { userId: user._id.toString(), email: user.email });
    return {
      workspaceId: workspaceIdStr,
      ownerToken: tokenFor(owner),
      editorToken: tokenFor(editor),
      viewerToken: tokenFor(viewer),
    };
  }

  it('creates and fetches a session over HTTP', async () => {
    const fx = await setupFixture();
    const created = await request
      .post('/api/v1/ai/copilot/session')
      .set(authHeader(fx.editorToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({ title: 'HTTP session' });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeDefined();

    const fetched = await request
      .get(`/api/v1/ai/copilot/${created.body.id}`)
      .set(authHeader(fx.editorToken))
      .set('X-Workspace-Id', fx.workspaceId);
    expect(fetched.status).toBe(200);
    expect(fetched.body.session.id).toBe(created.body.id);
  });

  it('rejects unauthenticated session creation with 401', async () => {
    const fx = await setupFixture();
    const res = await request
      .post('/api/v1/ai/copilot/session')
      .set('X-Workspace-Id', fx.workspaceId)
      .send({ title: 'nope' });
    expect(res.status).toBe(401);
  });

  it('allows VIEWER explain but denies VIEWER build with 403', async () => {
    const fx = await setupFixture();
    const session = await request
      .post('/api/v1/ai/copilot/session')
      .set(authHeader(fx.viewerToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({ title: 'viewer session' });
    expect(session.status).toBe(201);

    const explain = await request
      .post(`/api/v1/ai/copilot/${session.body.id}/message`)
      .set(authHeader(fx.viewerToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({ content: 'Explain how workflows work in general' });
    expect(explain.status).toBe(200);

    const build = await request
      .post(`/api/v1/ai/copilot/${session.body.id}/message`)
      .set(authHeader(fx.viewerToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({ content: 'Build me an onboarding workflow' });
    expect(build.status).toBe(403);
  });

  it('routes BUILD_WORKFLOW over HTTP for EDITOR', async () => {
    const fx = await setupFixture();
    const session = await request
      .post('/api/v1/ai/copilot/session')
      .set(authHeader(fx.editorToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({});
    expect(session.status).toBe(201);

    const message = await request
      .post(`/api/v1/ai/copilot/${session.body.id}/message`)
      .set(authHeader(fx.editorToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({ content: 'Build an employee onboarding workflow' });
    expect(message.status).toBe(200);
    expect(message.body.intent).toBe('BUILD_WORKFLOW');
    expect(message.body.response.artifacts.some((a: { kind: string }) => a.kind === 'DRAFT_WORKFLOW')).toBe(true);
  });

  it('returns 404 for unknown sessions and 400 for bad input', async () => {
    const fx = await setupFixture();
    const missing = await request
      .get(`/api/v1/ai/copilot/${new Types.ObjectId().toString()}`)
      .set(authHeader(fx.editorToken))
      .set('X-Workspace-Id', fx.workspaceId);
    expect(missing.status).toBe(404);

    const session = await request
      .post('/api/v1/ai/copilot/session')
      .set(authHeader(fx.editorToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({});
    const empty = await request
      .post(`/api/v1/ai/copilot/${session.body.id}/message`)
      .set(authHeader(fx.editorToken))
      .set('X-Workspace-Id', fx.workspaceId)
      .send({ content: '   ' });
    expect(empty.status).toBe(400);
  });
});


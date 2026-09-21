import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import type { WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';
import {
  AIApprovalPolicyModel,
  AIFeaturePolicyModel,
  AIModelAccessPolicyModel,
  AIPrivacyPolicyModel,
  AIPromptPolicyModel,
  AIUsageLimitPolicyModel,
} from '../src/models/AIGovernancePolicyModel.js';
import { AgentToolPolicyModel } from '../src/models/AgentToolPolicyModel.js';
import { AIGovernanceBudgetModel } from '../src/models/AIGovernanceBudgetModel.js';
import { AIUsageModel } from '../src/models/AIUsageModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { ApprovalRequestModel } from '../src/models/ApprovalRequestModel.js';
import { AIGovernancePolicyService } from '../src/services/aiGovernancePolicyService.js';
import { AIGovernanceGate } from '../src/services/aiGovernanceGate.js';
import { ApprovalService } from '../src/services/agent/approvalService.js';
import { AgentToolPolicyService } from '../src/services/agent/agentToolPolicyService.js';
import { AgentToolRegistry } from '../src/services/agent/agentToolRegistry.js';
import { AIProviderFactory } from '../src/services/ai/AIProviderFactory.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

const engine = AIGovernancePolicyService.getInstance();
const gate = AIGovernanceGate.getInstance();

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let workspaceId: string;
let otherWorkspaceId: string;
let ownerId: string;
let editorId: string;
let viewerId: string;
let ownerToken: string;
let editorToken: string;
let viewerToken: string;
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

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function clearGovernanceState() {
  await Promise.all([
    AIApprovalPolicyModel.deleteMany({}),
    AIFeaturePolicyModel.deleteMany({}),
    AIModelAccessPolicyModel.deleteMany({}),
    AIPrivacyPolicyModel.deleteMany({}),
    AIPromptPolicyModel.deleteMany({}),
    AIUsageLimitPolicyModel.deleteMany({}),
    AgentToolPolicyModel.deleteMany({}),
    AIGovernanceBudgetModel.deleteMany({}),
    AIUsageModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    ApprovalRequestModel.deleteMany({}),
  ]);
}
beforeEach(async () => {
  AIProviderFactory.resetMockProvider();
  await clearGovernanceState();
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await UserModel.deleteMany({});

  const stamp = new Types.ObjectId().toString();
  const owner = await UserModel.create({ email: `gov-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const editor = await UserModel.create({ email: `gov-editor-${stamp}@test.dev`, passwordHash: 'x' });
  const viewer = await UserModel.create({ email: `gov-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  ownerId = owner._id.toString();
  editorId = editor._id.toString();
  viewerId = viewer._id.toString();
  ownerToken = signAccessToken(authConfig, { userId: ownerId, email: `gov-owner-${stamp}@test.dev` });
  editorToken = signAccessToken(authConfig, { userId: editorId, email: `gov-editor-${stamp}@test.dev` });
  viewerToken = signAccessToken(authConfig, { userId: viewerId, email: `gov-viewer-${stamp}@test.dev` });

  const workspace = await WorkspaceModel.create({
    name: 'Governance WS',
    slug: `gov-${stamp}`,
    ownerId: new Types.ObjectId(ownerId),
  });
  workspaceId = workspace._id.toString();
  const otherWorkspace = await WorkspaceModel.create({
    name: 'Governance WS 2',
    slug: `gov2-${stamp}`,
    ownerId: new Types.ObjectId(ownerId),
  });
  otherWorkspaceId = otherWorkspace._id.toString();

  await WorkspaceMemberModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(ownerId),
    role: 'OWNER' as WorkspaceRole,
    status: 'ACTIVE',
    permissions: permissionsForRole('OWNER' as WorkspaceRole),
  });
  for (const [id, role] of [[editorId, 'EDITOR'], [viewerId, 'VIEWER']] as const) {
    await WorkspaceMemberModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(id),
      role,
      status: 'ACTIVE',
      permissions: permissionsForRole(role),
    });
  }
}, 60000);
describe('Phase 12.6 AI Governance - policy evaluation engine', () => {
  it('allows AI operations when no policies are configured', async () => {
    const decision = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      prompt: 'Build an approval workflow',
    });

    expect(decision.decision).toBe('ALLOW');
    expect(decision.requiredApproval).toBe(false);
    expect(decision.reasonCodes).toEqual([]);
    expect(await AuditLogModel.countDocuments({ workspaceId: new Types.ObjectId(workspaceId) })).toBe(0);
  });

  it('blocks disabled features and enforces role entitlements', async () => {
    await AIFeaturePolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      feature: 'AI_OPTIMIZATION',
      enabled: false,
      allowedRoles: [],
    });

    const disabled = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      role: 'OWNER',
      feature: 'AI_OPTIMIZATION',
    });
    expect(disabled.decision).toBe('DENY');
    expect(disabled.reasonCodes).toContain('FEATURE_DISABLED');

    await AIFeaturePolicyModel.updateOne(
      { workspaceId: new Types.ObjectId(workspaceId), feature: 'AI_OPTIMIZATION' },
      { enabled: true, allowedRoles: ['OWNER', 'ADMIN'] },
    );

    const editorDecision = await engine.evaluateRequest({
      workspaceId,
      userId: editorId,
      role: 'EDITOR',
      feature: 'AI_OPTIMIZATION',
    });
    expect(editorDecision.decision).toBe('DENY');
    expect(editorDecision.reasonCodes).toContain('ROLE_NOT_ALLOWED');

    const ownerDecision = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      role: 'OWNER',
      feature: 'AI_OPTIMIZATION',
    });
    expect(ownerDecision.decision).toBe('ALLOW');
  });
  it('enforces model access policies', async () => {
    await AIModelAccessPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      status: 'ACTIVE',
      blockedModels: ['gpt-4*'],
      allowedModels: [],
      allowedRoles: [],
    });

    const blocked = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'gpt-4o',
    });
    expect(blocked.decision).toBe('DENY');
    expect(blocked.reasonCodes).toContain('MODEL_BLOCKED');

    await AIModelAccessPolicyModel.updateOne(
      { workspaceId: new Types.ObjectId(workspaceId) },
      { blockedModels: [], allowedModels: ['claude-3-5-sonnet'] },
    );

    const notAllowed = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'gpt-4o-mini',
    });
    expect(notAllowed.decision).toBe('DENY');
    expect(notAllowed.reasonCodes).toContain('MODEL_NOT_ALLOWED');

    const allowed = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'claude-3-5-sonnet',
    });
    expect(allowed.decision).toBe('ALLOW');
  });

  it('filters prompts and requires approval for matched patterns', async () => {
    await AIPromptPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      blockedPatterns: ['drop\\s+database'],
      requiredApprovalPatterns: ['confidential'],
      severity: 'HIGH',
    });

    const blocked = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      prompt: 'Please drop database prod now',
    });
    expect(blocked.decision).toBe('DENY');
    expect(blocked.reasonCodes).toContain('PROMPT_BLOCKED');

    const gated = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      prompt: 'Summarise the confidential report',
    });
    expect(gated.decision).toBe('REQUIRE_APPROVAL');
    expect(gated.requiredApproval).toBe(true);
    expect(gated.approvalId).toBeDefined();
    expect(await ApprovalRequestModel.countDocuments({ workspaceId: new Types.ObjectId(workspaceId) })).toBe(1);
  });
  it('redacts sensitive data per privacy policy and blocks when configured', async () => {
    await AIPrivacyPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      allowedDataClasses: [],
      redactionRules: [],
      blockSensitiveData: false,
    });

    const redacted = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      prompt: 'Contact jane.doe@example.com about the order',
    });
    expect(redacted.decision).toBe('ALLOW_REDACTED');
    expect(redacted.redactions).toContain('email');
    expect(redacted.redactedPrompt).toContain('[REDACTED_EMAIL]');
    expect(redacted.redactedPrompt).not.toContain('jane.doe@example.com');

    await AIPrivacyPolicyModel.updateOne(
      { workspaceId: new Types.ObjectId(workspaceId) },
      { blockSensitiveData: true },
    );
    const blocked = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      prompt: 'Use key sk-abcdefghijklmnopqrstuvwxyz0123456789',
    });
    expect(blocked.decision).toBe('DENY');
    expect(blocked.reasonCodes).toContain('SENSITIVE_DATA_BLOCKED');
  });
  it('enforces workspace budget and usage limits', async () => {
    await AIGovernanceBudgetModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      monthlyTokenLimit: 1000,
      monthlyCostLimitUSD: 10,
      currentTokenUsage: 1000,
      currentCostUSD: 0,
      blockThreshold: 100,
      throttleThreshold: 90,
      alertThreshold: 80,
      alertEnabled: true,
      throttleEnabled: true,
      blockEnabled: true,
    });

    const blocked = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
    });
    expect(blocked.decision).toBe('DENY');
    expect(blocked.reasonCodes).toContain('BUDGET_BLOCKED');

    await AIGovernanceBudgetModel.deleteMany({ workspaceId: new Types.ObjectId(workspaceId) });
    await AIUsageLimitPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      dailyTokenLimit: 10,
      actionOnExceeded: 'BLOCK',
    });
    await AIUsageModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(ownerId),
      feature: 'workflow_generation',
      tokensUsed: 100,
      requests: 1,
      costEstimate: 0.01,
    });

    const limitBlocked = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      estimatedTokens: 50,
    });
    expect(limitBlocked.decision).toBe('DENY');
    expect(limitBlocked.reasonCodes).toContain('USAGE_LIMIT_BLOCKED');

    await AIUsageLimitPolicyModel.updateOne(
      { workspaceId: new Types.ObjectId(workspaceId) },
      { actionOnExceeded: 'THROTTLE' },
    );
    const throttled = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      estimatedTokens: 50,
    });
    expect(throttled.decision).toBe('THROTTLE');
    expect(throttled.throttled).toBe(true);
  });
  it('creates approvals for configured conditions and honours decisions on retry', async () => {
    await AIApprovalPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      conditions: { premiumModel: true, highCost: false, riskLevel: false, sensitivePrompt: false },
      highCostThresholdUSD: 1,
      requiredApproverRole: 'ADMIN',
    });

    const gated = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'gpt-4o',
    });
    expect(gated.decision).toBe('REQUIRE_APPROVAL');
    expect(gated.approvalId).toBeDefined();
    expect(gated.requiredApproverRole).toBe('ADMIN');

    const approvalId = gated.approvalId as string;
    const pending = await ApprovalRequestModel.findById(approvalId);
    expect(pending?.resourceType).toBe('AI_OPERATION');
    expect(pending?.status).toBe('PENDING');

    await ApprovalService.getInstance().approve(approvalId, workspaceId, ownerId, 'ok');
    const retried = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'gpt-4o',
      approvalId,
    });
    expect(retried.decision).toBe('ALLOW');
    expect(retried.reasonCodes).toContain('APPROVAL_SATISFIED');
  });
  it('denies retries of rejected approvals', async () => {
    await AIApprovalPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      conditions: { premiumModel: true, highCost: false, riskLevel: false, sensitivePrompt: false },
      highCostThresholdUSD: 1,
      requiredApproverRole: 'ADMIN',
    });

    const gated = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'gpt-4o',
    });
    const approvalId = gated.approvalId as string;
    await ApprovalService.getInstance().reject(approvalId, workspaceId, ownerId, 'no');

    const rejectedRetry = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'gpt-4o',
      approvalId,
    });
    expect(rejectedRetry.decision).toBe('DENY');
    expect(rejectedRetry.reasonCodes).toContain('APPROVAL_REJECTED');
  });

  it('isolates governance policies per workspace', async () => {
    await AIFeaturePolicyModel.create({
      workspaceId: new Types.ObjectId(otherWorkspaceId),
      feature: 'AI_ANALYSIS',
      enabled: false,
      allowedRoles: [],
    });

    const scoped = await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_ANALYSIS',
    });
    expect(scoped.decision).toBe('ALLOW');

    const blocked = await engine.evaluateRequest({
      workspaceId: otherWorkspaceId,
      userId: ownerId,
      feature: 'AI_ANALYSIS',
    });
    expect(blocked.decision).toBe('DENY');
    expect(blocked.reasonCodes).toContain('FEATURE_DISABLED');
  });
  it('audits deny and allow decisions with sanitized metadata', async () => {
    await AIPromptPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      blockedPatterns: ['forbidden-token'],
      requiredApprovalPatterns: [],
      severity: 'MEDIUM',
    });

    await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      prompt: 'contains forbidden-token here',
    });
    await engine.evaluateRequest({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
      prompt: 'clean prompt',
    });

    const wsId = new Types.ObjectId(workspaceId);
    expect(await AuditLogModel.countDocuments({ workspaceId: wsId, action: 'AI_GOVERNANCE_DENIED' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ workspaceId: wsId, action: 'AI_GOVERNANCE_ALLOWED' })).toBe(1);
    const denied = await AuditLogModel.findOne({ workspaceId: wsId, action: 'AI_GOVERNANCE_DENIED' }).lean();
    expect(denied?.resource).toBe('AI_OPERATION');
    expect(JSON.stringify(denied?.metadata ?? {})).not.toContain('forbidden-token');
  });
});

describe('Phase 12.6 AI Governance - gate and integration', () => {
  it('runGoverned returns PENDING_APPROVAL and executes on allow', async () => {
    await AIApprovalPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      conditions: { premiumModel: false, highCost: true, riskLevel: false, sensitivePrompt: false },
      highCostThresholdUSD: 0.5,
      requiredApproverRole: 'ADMIN',
    });

    const pending = await gate.runGoverned(
      {
        workspaceId,
        userId: ownerId,
        feature: 'AI_WORKFLOW_CREATE',
        estimatedCostUSD: 2,
      },
      async () => 'executed',
    );
    expect(pending.status).toBe('PENDING_APPROVAL');
    if (pending.status === 'PENDING_APPROVAL') expect(pending.approvalId).toBeDefined();

    const completed = await gate.runGoverned(
      {
        workspaceId,
        userId: ownerId,
        feature: 'AI_WORKFLOW_CREATE',
        estimatedCostUSD: 0.1,
      },
      async (context) => `executed:${context.model}`,
    );
    expect(completed.status).toBe('COMPLETED');
  });
  it('passes redacted prompts to executors and throws mapped errors on deny', async () => {
    await AIPrivacyPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      allowedDataClasses: [],
      redactionRules: [],
      blockSensitiveData: false,
    });

    const redacted = await gate.runGoverned(
      {
        workspaceId,
        userId: ownerId,
        feature: 'AI_WORKFLOW_CREATE',
        prompt: 'Email sam@example.com',
      },
      async (context) => context.prompt ?? '',
    );
    expect(redacted.status).toBe('COMPLETED');
    if (redacted.status === 'COMPLETED') {
      expect(redacted.result).toContain('[REDACTED_EMAIL]');
      expect(redacted.decision.decision).toBe('ALLOW_REDACTED');
    }

    await AIModelAccessPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      status: 'ACTIVE',
      blockedModels: ['gpt-4o'],
      allowedModels: [],
      allowedRoles: [],
    });
    await expect(
      gate.authorizeProvider({
        workspaceId,
        userId: ownerId,
        feature: 'AI_WORKFLOW_CREATE',
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('AI_GOVERNANCE_DENIED');
  });
  it('resolves governed providers through the provider factory', async () => {
    const resolved = await AIProviderFactory.getGovernedProviderForWorkspace({
      workspaceId,
      userId: ownerId,
      feature: 'AI_WORKFLOW_CREATE',
    });
    expect(resolved.providerName).toBe('mock');
    expect(resolved.decision.decision).toBe('ALLOW');

    await AIModelAccessPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      status: 'ACTIVE',
      blockedModels: ['*'],
      allowedModels: [],
      allowedRoles: [],
    });
    await expect(
      AIProviderFactory.getGovernedProviderForWorkspace({
        workspaceId,
        userId: ownerId,
        feature: 'AI_WORKFLOW_CREATE',
        model: 'mock-model',
      }),
    ).rejects.toThrow('AI_GOVERNANCE_DENIED');
  });

  it('persists agent tool policy overrides across cache resets', async () => {
    const toolName = AgentToolRegistry.getInstance().listTools()[0]?.name;
    expect(toolName).toBeDefined();
    if (!toolName) return;

    const policyService = AgentToolPolicyService.getInstance();
    await policyService.setPolicy(workspaceId, toolName, 'DENY', ownerId);
    expect(policyService.getPolicy(workspaceId, toolName)).toBe('DENY');
    expect(await AgentToolPolicyModel.countDocuments({ workspaceId: new Types.ObjectId(workspaceId), toolName })).toBe(1);

    policyService.clearWorkspace(workspaceId);
    expect(await policyService.resolvePolicy(workspaceId, toolName)).toBe('DENY');
  });
});
describe('Phase 12.6 AI Governance - API surface and RBAC', () => {
  it('creates, lists, updates and deletes policies for owners', async () => {
    const create = await request
      .post('/api/v1/ai/governance/policies')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ type: 'MODEL_ACCESS', blockedModels: ['gpt-4*'] });
    expect(create.status).toBe(201);
    expect(create.body.data.policyType).toBe('MODEL_ACCESS');
    const policyId = create.body.data._id as string;

    const list = await request
      .get('/api/v1/ai/governance/policies?type=MODEL_ACCESS')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const update = await request
      .put(`/api/v1/ai/governance/policies/${policyId}`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ status: 'DISABLED' });
    expect(update.status).toBe(200);
    expect(update.body.data.status).toBe('DISABLED');

    const remove = await request
      .delete(`/api/v1/ai/governance/policies/${policyId}`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(remove.status).toBe(200);

    const actions = await AuditLogModel.find({ workspaceId: new Types.ObjectId(workspaceId) }).distinct('action');
    expect(actions).toContain('AI_GOVERNANCE_POLICY_CREATED');
    expect(actions).toContain('AI_GOVERNANCE_POLICY_UPDATED');
    expect(actions).toContain('AI_GOVERNANCE_POLICY_DELETED');
  });

  it('enforces RBAC on the governance surface', async () => {
    const editorCreate = await request
      .post('/api/v1/ai/governance/policies')
      .set(authHeader(editorToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ type: 'MODEL_ACCESS' });
    expect(editorCreate.status).toBe(403);

    const viewerRead = await request
      .get('/api/v1/ai/governance/policies')
      .set(authHeader(viewerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(viewerRead.status).toBe(200);

    const viewerManage = await request
      .post('/api/v1/ai/governance/policies')
      .set(authHeader(viewerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ type: 'MODEL_ACCESS' });
    expect(viewerManage.status).toBe(403);
  });
  it('dry-runs evaluations and exposes audit events and summaries', async () => {
    await request
      .post('/api/v1/ai/governance/policies')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ type: 'PROMPT', blockedPatterns: ['secret-plan'] });

    const evaluate = await request
      .post('/api/v1/ai/governance/evaluate')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ feature: 'AI_WORKFLOW_CREATE', prompt: 'discuss secret-plan details' });
    expect(evaluate.status).toBe(200);
    expect(evaluate.body.data.decision).toBe('DENY');
    expect(
      await AuditLogModel.countDocuments({
        workspaceId: new Types.ObjectId(workspaceId),
        action: 'AI_GOVERNANCE_DENIED',
      }),
    ).toBe(0);

    const events = await request
      .get('/api/v1/ai/governance/audit/events?limit=10')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(events.status).toBe(200);
    expect(events.body.data.length).toBeGreaterThan(0);
    expect(events.body.data[0].action).toContain('AI_GOVERNANCE');

    const summary = await request
      .get('/api/v1/ai/governance/audit/summary?timeframe=24h')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(summary.status).toBe(200);
    expect(summary.body.data.decisions).toBeDefined();
    expect(summary.body.data.usage).toBeDefined();
  });
  it('lists and decides AI operation approvals', async () => {
    await AIApprovalPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      conditions: { premiumModel: true, highCost: false, riskLevel: false, sensitivePrompt: false },
      highCostThresholdUSD: 1,
      requiredApproverRole: 'ADMIN',
    });
    const decision = await engine.evaluateRequest({
      workspaceId,
      userId: editorId,
      feature: 'AI_WORKFLOW_CREATE',
      model: 'gpt-4o',
    });
    const approvalId = decision.approvalId as string;

    const queue = await request
      .get('/api/v1/ai/governance/approvals?status=PENDING')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(queue.status).toBe(200);
    expect(queue.body.data).toHaveLength(1);

    const approve = await request
      .post(`/api/v1/ai/governance/approvals/${approvalId}/approve`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ reason: 'ok' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');

    const replay = await request
      .post(`/api/v1/ai/governance/approvals/${approvalId}/approve`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(replay.status).toBe(409);

    expect(
      await AuditLogModel.countDocuments({
        workspaceId: new Types.ObjectId(workspaceId),
        action: 'AI_GOVERNANCE_APPROVED',
      }),
    ).toBe(1);
  });
});
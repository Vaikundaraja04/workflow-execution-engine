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
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { AgentToolPolicyModel } from '../src/models/AgentToolPolicyModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { AIUsageModel } from '../src/models/AIUsageModel.js';
import { AgentRunModel } from '../src/models/AgentRunModel.js';
import { InstalledAgentModel } from '../src/models/InstalledAgentModel.js';
import { AgentReviewModel } from '../src/models/AgentReviewModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

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
  process.env.AUTH_JWT_SECRET = authConfig.jwtSecret;
  process.env.WEBHOOK_SECRET_KEY = 'test-webhook-secret-key-0123456789abcdef';
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(
    createApp({ auth: authConfig, authRateLimit: { loginLimit: 1000, refreshLimit: 1000 } }),
  );
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function readiness(path: string, token: string, wsId: string = workspaceId) {
  return request
    .get(`/api/v1/release-readiness${path}`)
    .set(authHeader(token))
    .set('X-Workspace-Id', wsId);
}

async function seedExecution(wsId: string, status: 'SUCCEEDED' | 'FAILED' | 'QUEUED') {
  return WorkflowExecutionModel.create({
    workflowId: new Types.ObjectId(),
    ownerId: new Types.ObjectId(ownerId),
    workspaceId: new Types.ObjectId(wsId),
    workflowVersionId: new Types.ObjectId(),
    versionNumber: 1,
    jobId: `job-${new Types.ObjectId().toHexString()}`,
    idempotencyKey: `idem-${new Types.ObjectId().toHexString()}`,
    inputHash: 'hash',
    input: {},
    status,
    attemptsMade: 0,
    statusHistory: [],
  });
}

async function seedRun(wsId: string, overrides: Record<string, unknown> = {}) {
  return AgentRunModel.create({
    agentId: new Types.ObjectId(),
    workspaceId: new Types.ObjectId(wsId),
    status: 'SUCCEEDED',
    trace: [],
    toolCalls: [],
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    requestedBy: new Types.ObjectId(ownerId),
    startedAt: new Date(),
    ...overrides,
  });
}

async function seedApiKey(wsId: string, overrides: Record<string, unknown> = {}) {
  return APIKeyModel.create({
    workspaceId: new Types.ObjectId(wsId),
    name: `key-${new Types.ObjectId().toHexString().slice(-6)}`,
    keyHash: `hash-${new Types.ObjectId().toHexString()}`,
    keyPrefix: 'rrk_',
    status: 'ACTIVE',
    permissions: [],
    createdBy: new Types.ObjectId(ownerId),
    ...overrides,
  });
}
beforeEach(async () => {
  await Promise.all([
    APIKeyModel.deleteMany({}),
    AgentToolPolicyModel.deleteMany({}),
    WorkflowExecutionModel.deleteMany({}),
    AIUsageModel.deleteMany({}),
    AgentRunModel.deleteMany({}),
    InstalledAgentModel.deleteMany({}),
    AgentReviewModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const owner = await UserModel.create({ email: `rr-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const editor = await UserModel.create({ email: `rr-editor-${stamp}@test.dev`, passwordHash: 'x' });
  const viewer = await UserModel.create({ email: `rr-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  ownerId = owner._id.toString();
  editorId = editor._id.toString();
  viewerId = viewer._id.toString();
  ownerToken = signAccessToken(authConfig, { userId: ownerId, email: owner.email });
  editorToken = signAccessToken(authConfig, { userId: editorId, email: editor.email });
  viewerToken = signAccessToken(authConfig, { userId: viewerId, email: viewer.email });

  const workspace = await WorkspaceModel.create({
    name: 'Release Readiness WS',
    slug: `rr-${stamp}`,
    ownerId: new Types.ObjectId(ownerId),
  });
  workspaceId = workspace._id.toString();
  const otherWorkspace = await WorkspaceModel.create({
    name: 'Other WS',
    slug: `rr-other-${stamp}`,
    ownerId: new Types.ObjectId(ownerId),
  });
  otherWorkspaceId = otherWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [workspaceId, ownerId, 'OWNER'],
    [workspaceId, editorId, 'EDITOR'],
    [workspaceId, viewerId, 'VIEWER'],
  ];
  for (const [wsId, userId, role] of members) {
    await WorkspaceMemberModel.create({
      workspaceId: new Types.ObjectId(wsId),
      userId: new Types.ObjectId(userId),
      role,
      status: 'ACTIVE',
      permissions: permissionsForRole(role),
    });
  }
}, 60000);
describe('Phase 12.9 Release Readiness - security audit', () => {
  it('scores deterministic checks and reacts to planted findings', async () => {
    const baseline = await readiness('/security-audit', ownerToken);
    expect(baseline.status).toBe(200);
    const baselineReport = baseline.body.data;
    const find = (id: string) => baselineReport.findings.find((entry: { id: string }) => entry.id === id);

    expect(find('auth.jwt-secret').status).toBe('PASS');
    expect(find('auth.access-ttl').status).toBe('PASS');
    expect(find('apikeys.revocation').status).toBe('PASS');
    expect(find('tools.dangerous-allows').status).toBe('PASS');
    expect(find('isolation.workspace-scoped').status).toBe('PASS');
    expect(find('audit.action-coverage').status).toBe('PASS');
    expect(baselineReport.score).toBeGreaterThanOrEqual(80);
    expect(baselineReport.summary.failures).toBe(0);
    expect(baselineReport.findings.find((entry: { id: string }) => entry.id === 'secrets.webhook-key').status).toBe('PASS');

    delete process.env.WEBHOOK_SECRET_KEY;
    const fallback = await readiness('/security-audit', ownerToken);
    const fallbackFinding = fallback.body.data.findings.find((entry: { id: string }) => entry.id === 'secrets.webhook-key');
    expect(fallbackFinding.status).toBe(process.env.NODE_ENV === 'production' ? 'FAIL' : 'WARN');
    process.env.WEBHOOK_SECRET_KEY = 'test-webhook-secret-key-0123456789abcdef';

    await seedApiKey(workspaceId, { status: 'REVOKED' });
    await AgentToolPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      toolName: 'http_request',
      policy: 'ALLOW',
      updatedBy: new Types.ObjectId(ownerId),
    });

    const planted = await readiness('/security-audit', ownerToken);
    expect(planted.status).toBe(200);
    const plantedReport = planted.body.data;
    const findPlanted = (id: string) => plantedReport.findings.find((entry: { id: string }) => entry.id === id);

    expect(findPlanted('apikeys.revocation').status).toBe('FAIL');
    expect(findPlanted('apikeys.revocation').severity).toBe('MEDIUM');
    expect(findPlanted('tools.dangerous-allows').status).toBe('FAIL');
    expect(findPlanted('tools.dangerous-allows').severity).toBe('HIGH');
    expect(plantedReport.summary.failures).toBe(2);
    expect(plantedReport.score).toBe(baselineReport.score - 15);

    expect(await AuditLogModel.countDocuments({ action: 'SECURITY_AUDIT_COMPLETED' })).toBe(3);
  });
});
describe('Phase 12.9 Release Readiness - authorization', () => {
  it('enforces role permissions on audit, drill and reporting endpoints', async () => {
    const viewerAudit = await readiness('/security-audit', viewerToken);
    expect(viewerAudit.status).toBe(403);
    expect(viewerAudit.body.error.code).toBe('FORBIDDEN');

    const editorAudit = await readiness('/security-audit', editorToken);
    expect(editorAudit.status).toBe(403);

    const ownerAudit = await readiness('/security-audit', ownerToken);
    expect(ownerAudit.status).toBe(200);

    const viewerDrill = await readiness('/disaster-recovery', viewerToken);
    expect(viewerDrill.status).toBe(403);

    const editorDrill = await readiness('/disaster-recovery', editorToken);
    expect(editorDrill.status).toBe(403);
    expect(editorDrill.body.error.code).toBe('FORBIDDEN');

    const ownerDrill = await readiness('/disaster-recovery', ownerToken);
    expect(ownerDrill.status).toBe(200);
    expect(ownerDrill.body.data.backupStatus.status).toBe('VALID');

    const viewerReadiness = await readiness('/readiness', viewerToken);
    expect(viewerReadiness.status).toBe(403);

    const editorReadiness = await readiness('/readiness', editorToken);
    expect(editorReadiness.status).toBe(200);

    const editorMetrics = await readiness('/metrics', editorToken);
    expect(editorMetrics.status).toBe(200);

    const editorPerformance = await readiness('/performance', editorToken);
    expect(editorPerformance.status).toBe(403);
  });

  it('hides workspaces the caller is not a member of', async () => {
    const response = await readiness('/readiness', viewerToken, otherWorkspaceId);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('WORKSPACE_NOT_FOUND');
  });
});
describe('Phase 12.9 Release Readiness - deployment validation', () => {
  it('validates the production overlay manifests and queue/worker wiring', async () => {
    const response = await readiness('/deployment', ownerToken);
    expect(response.status).toBe(200);
    const report = response.body.data;

    expect(report.verdict).toBe('READY');
    expect(report.score).toBe(100);
    expect(report.files).toHaveLength(8);
    for (const file of report.files) {
      expect(file.present).toBe(true);
      expect(file.ok).toBe(true);
      expect(file.missing).toHaveLength(0);
    }
    expect(report.queueWorkerChecks).toHaveLength(3);
    for (const check of report.queueWorkerChecks) {
      expect(check.ok).toBe(true);
    }
  });
});

describe('Phase 12.9 Release Readiness - disaster recovery drill', () => {
  it('produces a validated snapshot with recovery estimate and integrity evidence', async () => {
    await seedApiKey(workspaceId);
    await seedApiKey(workspaceId, { status: 'REVOKED', revokedAt: new Date() });

    const response = await readiness('/disaster-recovery', ownerToken);
    expect(response.status).toBe(200);
    const report = response.body.data;

    expect(report.backupStatus.status).toBe('VALID');
    expect(typeof report.backupStatus.createdAt).toBe('string');
    expect(report.backupStatus.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(report.restoreTest.valid).toBe(true);
    expect(report.restoreTest.checksumValid).toBe(true);
    expect(report.restoreTest.countsMatch).toBe(true);
    expect(report.restoreTest.errors).toHaveLength(0);
    expect(report.dataIntegrity.totalRecords).toBe(3);
    expect(report.recoveryTimeEstimate.assumedRestoreFactor).toBe(2);
    expect(report.recoveryTimeEstimate.estimatedRecoveryMs).toBe(
      report.recoveryTimeEstimate.measuredBackupMs * 2,
    );
    expect(report.recoveryTimeEstimate.rtoTargetMs).toBe(4 * 60 * 60 * 1000);
    expect(report.recoveryTimeEstimate.rpoTargetMs).toBe(24 * 60 * 60 * 1000);
    expect(report.recoveryTimeEstimate.meetsRto).toBe(true);

    expect(await AuditLogModel.countDocuments({ action: 'BACKUP_VALIDATED' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'DR_TEST_COMPLETED' })).toBe(1);
  });
});
describe('Phase 12.9 Release Readiness - enterprise metrics', () => {
  it('aggregates latency, throughput, AI cost, agent execution and marketplace activity per workspace', async () => {
    await seedExecution(workspaceId, 'SUCCEEDED');
    await seedExecution(workspaceId, 'SUCCEEDED');
    await seedExecution(workspaceId, 'FAILED');
    await seedExecution(otherWorkspaceId, 'FAILED');

    await AIUsageModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(ownerId),
      feature: 'workflow_generation',
      tokensUsed: 1000,
      requests: 2,
      costEstimate: 0.5,
    });
    await AIUsageModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(ownerId),
      feature: 'failure_analysis',
      tokensUsed: 500,
      requests: 1,
      costEstimate: 0.25,
    });

    await seedRun(workspaceId, {
      status: 'SUCCEEDED',
      toolCalls: [{ toolName: 'calculate', args: {}, status: 'SUCCEEDED' }],
    });
    await seedRun(workspaceId, {
      status: 'FAILED',
      toolCalls: [{ toolName: 'http_request', args: {}, status: 'DENIED' }],
    });

    await InstalledAgentModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      agentMarketplaceId: new Types.ObjectId(),
      agentId: new Types.ObjectId(),
      installedVersion: 1,
      configuration: {},
      installedBy: new Types.ObjectId(ownerId),
      status: 'ACTIVE',
      installedAt: new Date(),
    });
    await InstalledAgentModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      agentMarketplaceId: new Types.ObjectId(),
      agentId: new Types.ObjectId(),
      installedVersion: 1,
      configuration: {},
      installedBy: new Types.ObjectId(ownerId),
      status: 'UNINSTALLED',
      installedAt: new Date(),
    });

    await AgentReviewModel.create({
      agentMarketplaceId: new Types.ObjectId(),
      userId: new Types.ObjectId(editorId),
      workspaceId: new Types.ObjectId(workspaceId),
      rating: 4,
    });
    const response = await readiness('/metrics', ownerToken);
    expect(response.status).toBe(200);
    const metrics = response.body.data;

    expect(metrics.windowHours).toBe(24);
    expect(typeof metrics.apiLatency.executionP95Ms).toBe('number');
    expect(metrics.workflowThroughput.executions).toBe(3);
    expect(metrics.workflowThroughput.succeeded).toBe(2);
    expect(metrics.workflowThroughput.failed).toBe(1);
    expect(metrics.workflowThroughput.successRatePercent).toBe(66.7);
    expect(metrics.workflowThroughput.executionsPerHour).toBe(0.13);

    expect(metrics.aiCost.requests).toBe(3);
    expect(metrics.aiCost.tokensUsed).toBe(1500);
    expect(metrics.aiCost.costEstimate).toBe(0.75);
    expect(metrics.aiCost.byFeature).toHaveLength(2);
    expect(metrics.aiCost.byFeature[0].feature).toBe('workflow_generation');
    expect(metrics.aiCost.byFeature[0].costEstimate).toBe(0.5);

    expect(metrics.agentExecution.totalRuns).toBe(2);
    expect(metrics.agentExecution.byStatus.SUCCEEDED).toBe(1);
    expect(metrics.agentExecution.byStatus.FAILED).toBe(1);
    expect(metrics.agentExecution.failureRatePercent).toBe(50);
    expect(metrics.agentExecution.toolCalls).toBe(2);
    expect(metrics.agentExecution.failedToolCalls).toBe(1);
    expect(metrics.agentExecution.toolErrorRatePercent).toBe(50);

    expect(metrics.marketplaceActivity.installsInWindow).toBe(2);
    expect(metrics.marketplaceActivity.activeInstalls).toBe(1);
    expect(metrics.marketplaceActivity.reviewsInWindow).toBe(1);
    expect(metrics.marketplaceActivity.averageRating).toBe(4);
    expect(metrics.marketplaceActivity.executionsInWindow).toBe(2);
  });

  it('clamps the reporting window to the supported range', async () => {
    const clamped = await request
      .get('/api/v1/release-readiness/metrics?windowHours=99999')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(clamped.status).toBe(200);
    expect(clamped.body.data.windowHours).toBe(720);

    const windowed = await request
      .get('/api/v1/release-readiness/metrics?windowHours=48')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(windowed.status).toBe(200);
    expect(windowed.body.data.windowHours).toBe(48);
  });
});
describe('Phase 12.9 Release Readiness - aggregate readiness and performance', () => {
  it('combines weighted dimensions into a bounded readiness score', async () => {
    const response = await readiness('/readiness', ownerToken);
    expect(response.status).toBe(200);
    const report = response.body.data;

    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(['READY', 'NEEDS_ATTENTION', 'NOT_READY']).toContain(report.verdict);

    expect(report.dimensions.security.score).toBeGreaterThan(0);
    expect(typeof report.dimensions.security.failures).toBe('number');
    expect(report.dimensions.database.verdict).toBe('HEALTHY');
    expect(report.dimensions.database.score).toBe(100);
    expect(report.dimensions.deployment.verdict).toBe('READY');
    expect(report.dimensions.queueWorker.passing).toBe(report.dimensions.queueWorker.checks);
    expect(report.deployment.files).toHaveLength(8);

    expect(await AuditLogModel.countDocuments({ action: 'DEPLOYMENT_READINESS_CHECKED' })).toBe(1);
  });
  it('runs the performance benchmark battery and records it in the audit trail', async () => {
    const response = await readiness('/performance', ownerToken);
    expect(response.status).toBe(200);
    const report = response.body.data;

    expect(report.operations).toHaveLength(7);
    for (const operation of report.operations) {
      expect(operation.iterations).toBe(5);
      expect(operation.medianMs).toBeGreaterThanOrEqual(0);
      expect(operation.worstMs).toBeGreaterThanOrEqual(operation.medianMs);
      expect(['PASS', 'WARN', 'FAIL']).toContain(operation.verdict);
      expect(typeof operation.thresholdMs).toBe('number');
    }
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(['PASS', 'WARN', 'FAIL']).toContain(report.verdict);
    expect(report.workspaceId).toBe(workspaceId);

    expect(await AuditLogModel.countDocuments({ action: 'PERFORMANCE_TEST_COMPLETED' })).toBe(1);
  });
});

describe('Phase 12.9 Release Readiness - audit trail', () => {
  it('writes all five readiness audit actions', async () => {
    await readiness('/security-audit', ownerToken);
    await readiness('/performance', ownerToken);
    await readiness('/disaster-recovery', ownerToken);
    await readiness('/readiness', ownerToken);

    const actions = [
      'SECURITY_AUDIT_COMPLETED',
      'PERFORMANCE_TEST_COMPLETED',
      'BACKUP_VALIDATED',
      'DR_TEST_COMPLETED',
      'DEPLOYMENT_READINESS_CHECKED',
    ] as const;
    for (const action of actions) {
      expect(await AuditLogModel.countDocuments({ action })).toBeGreaterThanOrEqual(1);
    }
  });
});

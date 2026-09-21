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
import { AgentModel } from '../src/models/AgentModel.js';
import { AgentMarketplaceModel } from '../src/models/AgentMarketplaceModel.js';
import { AgentVersionModel } from '../src/models/AgentVersionModel.js';
import { InstalledAgentModel } from '../src/models/InstalledAgentModel.js';
import { AgentReviewModel } from '../src/models/AgentReviewModel.js';
import { AgentRunModel } from '../src/models/AgentRunModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { NotificationModel } from '../src/models/NotificationModel.js';
import { AIFeaturePolicyModel, AIModelAccessPolicyModel } from '../src/models/AIGovernancePolicyModel.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

async function backdate(
  model: { collection: { updateOne: (filter: object, update: object) => Promise<unknown> } },
  id: Types.ObjectId | string,
  date: Date,
) {
  await model.collection.updateOne(
    { _id: new Types.ObjectId(String(id)) },
    { $set: { createdAt: date } },
  );
}

async function seedAgent(wsId: string, userId: string, overrides: Record<string, unknown> = {}) {
  return AgentModel.create({
    workspaceId: new Types.ObjectId(wsId),
    name: `Intel Agent ${new Types.ObjectId().toHexString().slice(-6)}`,
    systemPrompt: 'Triage incidents.',
    toolsAllowed: ['calculate'],
    status: 'ACTIVE',
    createdBy: new Types.ObjectId(userId),
    ...overrides,
  });
}
async function seedListing(wsId: string, publisherId: string, overrides: Record<string, unknown> = {}) {
  const agent = await seedAgent(wsId, publisherId);
  const agentSnapshot = {
    name: 'Snapshot agent',
    systemPrompt: 'Triage incidents.',
    modelConfig: { model: 'gpt-4o-mini' },
    orchestrationMode: 'autonomous',
    toolsAllowed: ['calculate'],
    requiredPermissions: [],
    memoryEnabled: false,
  };
  const listing = await AgentMarketplaceModel.create({
    workspaceId: new Types.ObjectId(wsId),
    agentId: agent._id,
    publisherId: new Types.ObjectId(publisherId),
    name: `Listing ${new Types.ObjectId().toHexString().slice(-6)}`,
    description: 'Marketplace listing for intelligence tests.',
    category: 'Operations',
    tags: ['ops'],
    visibility: 'PUBLIC',
    status: 'PUBLISHED',
    versionCount: 1,
    agentSnapshot,
    createdBy: new Types.ObjectId(publisherId),
    ...overrides,
  });
  await AgentVersionModel.create({
    agentMarketplaceId: listing._id,
    versionNumber: 1,
    agentDefinitionSnapshot: agentSnapshot,
    toolConfiguration: { calculate: 'ALLOW' },
    governanceSnapshot: { reasonCodes: [], toolPolicies: { calculate: 'ALLOW' } },
    changeSummary: 'Initial publication',
    hash: new Types.ObjectId().toHexString() + new Types.ObjectId().toHexString(),
    createdBy: new Types.ObjectId(publisherId),
  });
  return listing;
}
async function seedInstall(
  listingId: string,
  wsId: string,
  installedBy: string,
  overrides: Record<string, unknown> = {},
) {
  const clone = await seedAgent(wsId, installedBy, {
    name: `Clone ${new Types.ObjectId().toHexString().slice(-6)}`,
  });
  const install = await InstalledAgentModel.create({
    workspaceId: new Types.ObjectId(wsId),
    agentMarketplaceId: new Types.ObjectId(listingId),
    agentId: clone._id,
    installedVersion: 1,
    configuration: {},
    installedBy: new Types.ObjectId(installedBy),
    status: 'ACTIVE',
    installedAt: new Date(),
    ...overrides,
  });
  return { install, clone };
}

async function seedRun(agentId: Types.ObjectId, wsId: string, overrides: Record<string, unknown> = {}) {
  return AgentRunModel.create({
    agentId,
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
beforeEach(async () => {
  await Promise.all([
    AgentMarketplaceModel.deleteMany({}),
    AgentVersionModel.deleteMany({}),
    InstalledAgentModel.deleteMany({}),
    AgentReviewModel.deleteMany({}),
    AgentRunModel.deleteMany({}),
    AgentModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    NotificationModel.deleteMany({}),
    AIFeaturePolicyModel.deleteMany({}),
    AIModelAccessPolicyModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const owner = await UserModel.create({ email: `intel-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const editor = await UserModel.create({ email: `intel-editor-${stamp}@test.dev`, passwordHash: 'x' });
  const viewer = await UserModel.create({ email: `intel-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  ownerId = owner._id.toString();
  editorId = editor._id.toString();
  viewerId = viewer._id.toString();
  ownerToken = signAccessToken(authConfig, { userId: ownerId, email: owner.email });
  editorToken = signAccessToken(authConfig, { userId: editorId, email: editor.email });
  viewerToken = signAccessToken(authConfig, { userId: viewerId, email: viewer.email });

  const workspace = await WorkspaceModel.create({
    name: 'Intelligence WS',
    slug: `intel-${stamp}`,
    ownerId: new Types.ObjectId(ownerId),
  });
  workspaceId = workspace._id.toString();
  const otherWorkspace = await WorkspaceModel.create({
    name: 'Consumer WS',
    slug: `intel2-${stamp}`,
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
describe('Phase 12.8 Marketplace Intelligence - analytics', () => {
  it('reports installs over time, active installations and adoption with workspace scoping', async () => {
    const listing = await seedListing(workspaceId, ownerId, { installCount: 3 });
    const { install: installA, clone: cloneA } = await seedInstall(listing._id.toString(), otherWorkspaceId, ownerId);
    const thirdWorkspace = await WorkspaceModel.create({
      name: 'Third Consumer WS',
      slug: `intel3-${new Types.ObjectId().toString()}`,
      ownerId: new Types.ObjectId(ownerId),
    });
    const thirdWorkspaceId = thirdWorkspace._id.toString();
    const { install: installB, clone: cloneB } = await seedInstall(listing._id.toString(), thirdWorkspaceId, ownerId);
    const { clone: cloneC } = await seedInstall(listing._id.toString(), workspaceId, ownerId);

    await backdate(InstalledAgentModel, installA._id, new Date(Date.now() - 2 * DAY_MS));
    await backdate(InstalledAgentModel, installB._id, new Date(Date.now() - 40 * DAY_MS));

    await seedRun(cloneA._id, otherWorkspaceId, { status: 'SUCCEEDED' });
    await seedRun(cloneB._id, thirdWorkspaceId, { status: 'FAILED' });
    await seedRun(cloneC._id, workspaceId, { status: 'SUCCEEDED' });

    const response = await request
      .get('/api/v1/agent-marketplace/analytics?timeframe=30d')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(response.status).toBe(200);

    const analytics = response.body.data;
    expect(analytics.timeframe).toBe('30d');
    expect(analytics.publisher.installsOverTime).toHaveLength(30);
    expect(analytics.publisher.installsInWindow).toBe(2);
    const totalBuckets = (analytics.publisher.installsOverTime as Array<{ count: number }>)
      .reduce((sum, bucket) => sum + bucket.count, 0);
    expect(totalBuckets).toBe(2);
    expect(analytics.publisher.lifetimeInstalls).toBe(3);
    expect(analytics.publisher.activeInstalls).toBe(3);
    expect(analytics.publisher.executionsInWindow).toBe(3);
    expect(analytics.publisher.adoptionRate).toBe(1);

    expect(analytics.workspace.activeInstallations).toBe(1);
    expect(analytics.workspace.executionsInWindow).toBe(1);

    const perListing = analytics.publisher.perListing.find(
      (entry: { listingId: string }) => entry.listingId === listing._id.toString(),
    );
    expect(perListing.installs).toBe(3);
    expect(perListing.executions).toBe(3);

    expect(
      await AuditLogModel.countDocuments({ action: 'OPERATIONS_METRICS_VIEWED' }),
    ).toBeGreaterThanOrEqual(1);
  });
});
describe('Phase 12.8 Marketplace Intelligence - health scoring', () => {
  it('scores listings from version adoption, failures, tool errors, policy blocks and review trends', async () => {
    const listing = await seedListing(workspaceId, ownerId, { versionCount: 2 });
    const { clone: cloneA } = await seedInstall(listing._id.toString(), otherWorkspaceId, ownerId, {
      installedVersion: 2,
    });
    const { clone: cloneB } = await seedInstall(listing._id.toString(), workspaceId, ownerId, {
      installedVersion: 1,
    });

    await seedRun(cloneA._id, otherWorkspaceId, { status: 'SUCCEEDED' });
    await seedRun(cloneA._id, otherWorkspaceId, { status: 'FAILED' });
    await seedRun(cloneB._id, workspaceId, {
      status: 'FAILED',
      toolCalls: [{ toolName: 'http_request', args: {}, status: 'DENIED' }],
    });
    await seedRun(cloneB._id, workspaceId, {
      status: 'FAILED',
      toolCalls: [{ toolName: 'calculate', args: {}, status: 'SUCCEEDED' }],
    });

    await AuditLogModel.create({
      action: 'AGENT_MARKETPLACE_POLICY_BLOCKED',
      workspaceId: new Types.ObjectId(workspaceId),
      resource: 'AgentMarketplace',
      resourceId: listing._id.toString(),
    });
    await AuditLogModel.create({
      action: 'AGENT_MARKETPLACE_POLICY_BLOCKED',
      workspaceId: new Types.ObjectId(workspaceId),
      resource: 'AgentMarketplace',
      resourceId: listing._id.toString(),
    });
    const recentReview = await AgentReviewModel.create({
      agentMarketplaceId: listing._id,
      userId: new Types.ObjectId(ownerId),
      workspaceId: new Types.ObjectId(otherWorkspaceId),
      rating: 2,
    });
    expect(recentReview).toBeDefined();
    const olderReview = await AgentReviewModel.create({
      agentMarketplaceId: listing._id,
      userId: new Types.ObjectId(editorId),
      workspaceId: new Types.ObjectId(otherWorkspaceId),
      rating: 4,
    });
    await backdate(AgentReviewModel, olderReview._id, new Date(Date.now() - 45 * DAY_MS));

    const response = await request
      .get(`/api/v1/agent-marketplace/health?listingId=${listing._id.toString()}`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(response.status).toBe(200);

    const report = response.body.data.reports[0];
    expect(report.signals.versionAdoption).toBe(0.5);
    expect(report.signals.failureRate).toBe(0.75);
    expect(report.signals.toolErrorRate).toBe(0.5);
    expect(report.signals.policyViolations).toBe(2);
    expect(report.signals.recentAverageRating).toBe(2);
    expect(report.signals.reviewTrend).toBe(-2);
    expect(report.band).toBe('AT_RISK');
    expect(report.confidence).toBe('HIGH');
    expect(report.runsAnalyzed).toBe(4);

    expect(await AuditLogModel.countDocuments({ action: 'AGENT_HEALTH_EVALUATED' })).toBe(1);
  });

  it('hides private listings from other workspaces on the health endpoint', async () => {
    const privateListing = await seedListing(workspaceId, ownerId, { visibility: 'PRIVATE' });
    const response = await request
      .get(`/api/v1/agent-marketplace/health?listingId=${privateListing._id.toString()}`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(response.status).toBe(404);
  });
});
describe('Phase 12.8 Marketplace Intelligence - recommendations', () => {
  it('ranks governance-cleared candidates by affinity and excludes installed agents', async () => {
    const installedListing = await seedListing(workspaceId, ownerId, { category: 'Operations', tags: ['ops'] });
    await seedInstall(installedListing._id.toString(), workspaceId, ownerId, { status: 'ACTIVE' });

    const affinityListing = await seedListing(workspaceId, ownerId, {
      category: 'Operations',
      tags: ['ops'],
      installCount: 12,
      rating: { average: 4.6, count: 3 },
    });
    await seedListing(workspaceId, ownerId, { category: 'Monitoring', tags: ['alerts'] });

    const response = await request
      .get('/api/v1/agent-marketplace/recommendations?limit=5')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(response.status).toBe(200);

    const items = response.body.data.items as Array<{ listingId: string; reasons: string[]; score: number }>;
    const ids = items.map((item) => item.listingId);
    expect(ids).not.toContain(installedListing._id.toString());
    expect(ids[0]).toBe(affinityListing._id.toString());
    expect(items[0]?.reasons.join(' ')).toContain('Matches your Operations usage');
    expect(items[0]?.reasons.join(' ')).toContain('Shares tags with installed agents');
    expect(response.body.data.blockedByGovernance).toHaveLength(0);

    expect(
      await AuditLogModel.countDocuments({ action: 'MARKETPLACE_RECOMMENDATIONS_VIEWED' }),
    ).toBe(1);
  });
  it('never recommends candidates whose model is blocked by workspace policy', async () => {
    await AIModelAccessPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      status: 'ACTIVE',
      blockedModels: ['gpt-4*'],
      allowedModels: [],
      allowedRoles: [],
    });
    const blockedListing = await seedListing(workspaceId, ownerId, {
      agentSnapshot: {
        name: 'Blocked agent',
        systemPrompt: 'x',
        modelConfig: { model: 'gpt-4o' },
        orchestrationMode: 'autonomous',
        toolsAllowed: ['calculate'],
        requiredPermissions: [],
        memoryEnabled: false,
      },
    });
    const allowedListing = await seedListing(workspaceId, ownerId, {
      agentSnapshot: {
        name: 'Allowed agent',
        systemPrompt: 'x',
        modelConfig: { model: 'claude-3-5-sonnet' },
        orchestrationMode: 'autonomous',
        toolsAllowed: ['calculate'],
        requiredPermissions: [],
        memoryEnabled: false,
      },
    });

    const response = await request
      .get('/api/v1/agent-marketplace/recommendations')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(response.status).toBe(200);

    const ids = (response.body.data.items as Array<{ listingId: string }>).map((item) => item.listingId);
    expect(ids).not.toContain(blockedListing._id.toString());
    expect(ids).toContain(allowedListing._id.toString());

    const blocked = response.body.data.blockedByGovernance as Array<{
      listingId: string;
      reasonCodes: string[];
    }>;
    const blockedEntry = blocked.find((entry) => entry.listingId === blockedListing._id.toString());
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry?.reasonCodes).toContain('MODEL_BLOCKED');
  });
});
describe('Phase 12.8 Marketplace Intelligence - recommendation shaping', () => {
  it('short-circuits to an empty feed when AI agents are disabled for the workspace', async () => {
    await seedListing(workspaceId, ownerId);
    await AIFeaturePolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      feature: 'AI_AGENT',
      enabled: false,
      allowedRoles: [],
    });

    const response = await request
      .get('/api/v1/agent-marketplace/recommendations')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(0);
    expect(response.body.data.featurePolicy.decision).toBe('DENY');
    expect(response.body.data.featurePolicy.reasonCodes).toContain('FEATURE_DISABLED');
  });

  it('shapes the feed read-only for roles without AGENT_INSTALL', async () => {
    await seedListing(workspaceId, ownerId);

    const viewerResponse = await request
      .get('/api/v1/agent-marketplace/recommendations')
      .set(authHeader(viewerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(viewerResponse.status).toBe(200);
    expect(viewerResponse.body.data.installable).toBe(false);
    expect(viewerResponse.body.data.items[0].installable).toBe(false);

    const editorResponse = await request
      .get('/api/v1/agent-marketplace/recommendations')
      .set(authHeader(editorToken))
      .set('X-Workspace-Id', workspaceId);
    expect(editorResponse.body.data.installable).toBe(true);
  });
});
describe('Phase 12.8 Marketplace Intelligence - lifecycle automation', () => {
  it('detects updates, deprecated versions, inactive agents and notifies publishers once', async () => {
    await WorkspaceMemberModel.create({
      workspaceId: new Types.ObjectId(otherWorkspaceId),
      userId: new Types.ObjectId(ownerId),
      role: 'OWNER',
      status: 'ACTIVE',
      permissions: permissionsForRole('OWNER'),
    });

    const listing = await seedListing(workspaceId, ownerId, { versionCount: 3 });
    const { clone: cloneLatest } = await seedInstall(listing._id.toString(), otherWorkspaceId, ownerId, {
      installedVersion: 2,
    });
    const { clone: cloneStale } = await seedInstall(listing._id.toString(), workspaceId, ownerId, {
      installedVersion: 1,
    });
    await seedRun(cloneLatest._id, otherWorkspaceId, { status: 'SUCCEEDED' });
    expect(cloneStale).toBeDefined();

    const inactiveListing = await seedListing(workspaceId, ownerId, { versionCount: 1 });

    const consumerScan = await request
      .get('/api/v1/agent-marketplace/lifecycle')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(consumerScan.status).toBe(200);
    const installerTypes = (consumerScan.body.data.installer.events as Array<{ type: string }>).map((event) => event.type);
    expect(installerTypes).toContain('UPDATE_AVAILABLE');
    expect(consumerScan.body.data.summary.updates).toBe(1);

    const publisherScan = await request
      .get('/api/v1/agent-marketplace/lifecycle')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(publisherScan.status).toBe(200);
    const publisherInstallerTypes = (publisherScan.body.data.installer.events as Array<{ type: string }>)
      .map((event) => event.type);
    expect(publisherInstallerTypes).toContain('DEPRECATED_VERSION');
    expect(publisherInstallerTypes).toContain('INACTIVE_AGENT');
    expect(publisherScan.body.data.summary.deprecated).toBe(1);
    expect(publisherScan.body.data.summary.inactiveAgents).toBe(1);

    const publisherTypes = (publisherScan.body.data.publisher.events as Array<{ type: string }>).map((event) => event.type);
    expect(publisherTypes).toContain('INACTIVE_LISTING');
    expect(publisherScan.body.data.publisher.notificationsCreated).toBe(1);
    expect(await NotificationModel.countDocuments({})).toBe(2);
    expect(inactiveListing._id).toBeDefined();
  });

  it('deduplicates publisher notifications across scans', async () => {
    await seedListing(workspaceId, ownerId, { versionCount: 1 });

    const first = await request
      .get('/api/v1/agent-marketplace/lifecycle')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(first.body.data.publisher.notificationsCreated).toBe(1);

    const second = await request
      .get('/api/v1/agent-marketplace/lifecycle')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(second.body.data.publisher.notificationsCreated).toBe(0);

    expect(await NotificationModel.countDocuments({})).toBe(1);
    expect(
      await AuditLogModel.countDocuments({ action: 'AGENT_LIFECYCLE_EVENT_TRIGGERED' }),
    ).toBe(2);
  });
});
describe('Phase 12.8 Marketplace Intelligence - authorization and governance bypass prevention', () => {
  it('allows read-only roles on every intelligence endpoint and hides non-member workspaces', async () => {
    await seedListing(workspaceId, ownerId);

    for (const path of ['/analytics', '/recommendations', '/health', '/lifecycle']) {
      const viewerResponse = await request
        .get(`/api/v1/agent-marketplace${path}`)
        .set(authHeader(viewerToken))
        .set('X-Workspace-Id', workspaceId);
      expect(viewerResponse.status).toBe(200);
    }

    const nonMember = await request
      .get('/api/v1/agent-marketplace/analytics')
      .set(authHeader(viewerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(nonMember.status).toBe(404);
  });

  it('keeps the install governance gate intact for blocked models', async () => {
    await AIModelAccessPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      status: 'ACTIVE',
      blockedModels: ['gpt-4o-mini'],
      allowedModels: [],
      allowedRoles: [],
    });
    const listing = await seedListing(workspaceId, ownerId);

    const install = await request
      .post(`/api/v1/agent-marketplace/agents/${listing._id.toString()}/install`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({});
    expect(install.status).toBe(403);
    expect(install.body.error.code).toBe('AGENT_MARKETPLACE_POLICY_BLOCKED');

    const recommendations = await request
      .get('/api/v1/agent-marketplace/recommendations')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    const ids = (recommendations.body.data.items as Array<{ listingId: string }>).map((item) => item.listingId);
    expect(ids).not.toContain(listing._id.toString());
    expect((recommendations.body.data.blockedByGovernance as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});
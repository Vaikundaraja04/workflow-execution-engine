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
import { PublisherProfileModel } from '../src/models/PublisherProfileModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { AIFeaturePolicyModel, AIModelAccessPolicyModel } from '../src/models/AIGovernancePolicyModel.js';
import { AgentToolPolicyService } from '../src/services/agent/agentToolPolicyService.js';
import { AgentService } from '../src/services/agent/agentService.js';

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
let otherOwnerId: string;
let otherEditorId: string;
let ownerToken: string;
let editorToken: string;
let viewerToken: string;
let otherOwnerToken: string;
let otherEditorToken: string;

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

async function createAgentFor(
  workspaceIdValue: string,
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  return AgentService.getInstance().createAgent(workspaceIdValue, userId, {
    name: `Marketplace Agent ${new Types.ObjectId().toHexString().slice(-6)}`,
    systemPrompt: 'Summarise operational incidents and propose remediation steps.',
    toolsAllowed: ['calculate'],
    ...overrides,
  } as never);
}
beforeEach(async () => {
  await Promise.all([
    AgentMarketplaceModel.deleteMany({}),
    AgentVersionModel.deleteMany({}),
    InstalledAgentModel.deleteMany({}),
    AgentReviewModel.deleteMany({}),
    PublisherProfileModel.deleteMany({}),
    AgentModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    AIFeaturePolicyModel.deleteMany({}),
    AIModelAccessPolicyModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const owner = await UserModel.create({ email: `mkt-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const editor = await UserModel.create({ email: `mkt-editor-${stamp}@test.dev`, passwordHash: 'x' });
  const viewer = await UserModel.create({ email: `mkt-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  const otherOwner = await UserModel.create({ email: `mkt-owner2-${stamp}@test.dev`, passwordHash: 'x' });
  const otherEditor = await UserModel.create({ email: `mkt-editor2-${stamp}@test.dev`, passwordHash: 'x' });
  ownerId = owner._id.toString();
  editorId = editor._id.toString();
  viewerId = viewer._id.toString();
  otherOwnerId = otherOwner._id.toString();
  otherEditorId = otherEditor._id.toString();
  ownerToken = signAccessToken(authConfig, { userId: ownerId, email: owner.email });
  editorToken = signAccessToken(authConfig, { userId: editorId, email: editor.email });
  viewerToken = signAccessToken(authConfig, { userId: viewerId, email: viewer.email });
  otherOwnerToken = signAccessToken(authConfig, { userId: otherOwnerId, email: otherOwner.email });
  otherEditorToken = signAccessToken(authConfig, { userId: otherEditorId, email: otherEditor.email });
  const workspace = await WorkspaceModel.create({
    name: 'Publisher WS',
    slug: `mkt-${stamp}`,
    ownerId: new Types.ObjectId(ownerId),
  });
  workspaceId = workspace._id.toString();
  const otherWorkspace = await WorkspaceModel.create({
    name: 'Consumer WS',
    slug: `mkt2-${stamp}`,
    ownerId: new Types.ObjectId(otherOwnerId),
  });
  otherWorkspaceId = otherWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [workspaceId, ownerId, 'OWNER'],
    [workspaceId, editorId, 'EDITOR'],
    [workspaceId, viewerId, 'VIEWER'],
    [otherWorkspaceId, otherOwnerId, 'OWNER'],
    [otherWorkspaceId, otherEditorId, 'EDITOR'],
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
async function createListingFor(
  agentId: string,
  token: string,
  wsId: string,
  body: Record<string, unknown> = {},
) {
  return request
    .post('/api/v1/agent-marketplace/agents')
    .set(authHeader(token))
    .set('X-Workspace-Id', wsId)
    .send({ agentId, ...body });
}

async function publishListing(
  listingId: string,
  token: string,
  wsId: string,
) {
  return request
    .post(`/api/v1/agent-marketplace/agents/${listingId}/publish`)
    .set(authHeader(token))
    .set('X-Workspace-Id', wsId)
    .send({});
}
describe('Phase 12.7 Agent Marketplace - listings and publishing', () => {
  it('creates a DRAFT listing for a workspace agent and rejects duplicates', async () => {
    const agent = await createAgentFor(workspaceId, ownerId);
    const create = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      category: 'Operations',
      tags: ['ops', 'incidents'],
      visibility: 'PUBLIC',
    });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe('DRAFT');
    expect(create.body.data.name).toBe(agent.name);

    const duplicate = await createListingFor(agent._id.toString(), ownerToken, workspaceId);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('LISTING_ALREADY_EXISTS');

    const actions = await AuditLogModel.find({
      workspaceId: new Types.ObjectId(workspaceId),
    }).distinct('action');
    expect(actions).toContain('AGENT_LISTING_CREATED');
  });

  it('publishes a governance-clean agent with its first version', async () => {
    const agent = await createAgentFor(workspaceId, ownerId, {
      toolsAllowed: ['calculate'],
      modelConfig: { model: 'gpt-4o-mini' },
    });
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const listingId = created.body.data._id as string;

    const publish = await publishListing(listingId, ownerToken, workspaceId);
    expect(publish.status).toBe(200);
    expect(publish.body.data.status).toBe('PUBLISHED');
    expect(publish.body.data.versionCount).toBe(1);

    const versions = await AgentVersionModel.find({
      agentMarketplaceId: new Types.ObjectId(listingId),
    }).lean();
    expect(versions).toHaveLength(1);
    expect(versions[0]?.versionNumber).toBe(1);
    expect(versions[0]?.hash).toHaveLength(64);
  });
});
describe('Phase 12.7 Agent Marketplace - governance admission', () => {
  it('blocks publishing when a governance policy denies the agent model', async () => {
    await AIModelAccessPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      status: 'ACTIVE',
      blockedModels: ['gpt-4*'],
      allowedModels: [],
      allowedRoles: [],
    });
    const agent = await createAgentFor(workspaceId, ownerId, {
      modelConfig: { model: 'gpt-4o' },
    });
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const listingId = created.body.data._id as string;

    const blocked = await publishListing(listingId, ownerToken, workspaceId);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('AGENT_MARKETPLACE_POLICY_BLOCKED');

    const listing = await AgentMarketplaceModel.findById(listingId).lean();
    expect(listing?.status).toBe('DRAFT');
    expect(
      await AuditLogModel.countDocuments({ action: 'AGENT_MARKETPLACE_POLICY_BLOCKED' }),
    ).toBe(1);
  });

  it('blocks publishing when a workspace tool policy denies one of the agent tools', async () => {
    await AgentToolPolicyService.getInstance().setPolicy(workspaceId, 'http_request', 'DENY', ownerId);
    const agent = await createAgentFor(workspaceId, ownerId, {
      toolsAllowed: ['http_request'],
    });
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });

    const blocked = await publishListing(created.body.data._id as string, ownerToken, workspaceId);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('AGENT_MARKETPLACE_POLICY_BLOCKED');
    const audit = await AuditLogModel.findOne({ action: 'AGENT_MARKETPLACE_POLICY_BLOCKED' }).lean();
    expect(JSON.stringify(audit?.metadata ?? {})).toContain('http_request');
  });
});
describe('Phase 12.7 Agent Marketplace - discovery and installation', () => {
  async function publishPublicAgent(
    wsId: string,
    token: string,
    agentOverrides: Record<string, unknown> = {},
    listingBody: Record<string, unknown> = {},
  ) {
    const agent = await createAgentFor(wsId, ownerId, agentOverrides);
    const created = await createListingFor(agent._id.toString(), token, wsId, {
      visibility: 'PUBLIC',
      ...listingBody,
    });
    const listingId = created.body.data._id as string;
    const publish = await publishListing(listingId, token, wsId);
    return { agent, listingId, publish };
  }
  it('searches published listings and respects visibility rules', async () => {
    const { listingId } = await publishPublicAgent(workspaceId, ownerToken, {}, {
      category: 'Operations',
      tags: ['incident'],
    });
    const privateAgent = await createAgentFor(workspaceId, ownerId);
    const privateCreated = await createListingFor(privateAgent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PRIVATE',
    });
    await publishListing(privateCreated.body.data._id as string, ownerToken, workspaceId);

    const consumerSearch = await request
      .get('/api/v1/agent-marketplace/agents')
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(consumerSearch.status).toBe(200);
    const consumerIds = (consumerSearch.body.data.items as Array<{ _id: string }>).map((item) => item._id);
    expect(consumerIds).toContain(listingId);
    expect(consumerIds).not.toContain(privateCreated.body.data._id);

    const aliasSearch = await request
      .get('/api/v1/agent-marketplace/search')
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(aliasSearch.status).toBe(200);

    const publisherSearch = await request
      .get('/api/v1/agent-marketplace/agents')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    const publisherIds = (publisherSearch.body.data.items as Array<{ _id: string }>).map((item) => item._id);
    expect(publisherIds).toContain(privateCreated.body.data._id);
  });
  it('installs a published agent into another workspace and clones it locally', async () => {
    const { listingId } = await publishPublicAgent(workspaceId, ownerToken, { toolsAllowed: ['calculate'] });

    const install = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({ configuration: { temperature: 0.2 } });
    expect(install.status).toBe(201);
    expect(install.body.data.install.installedVersion).toBe(1);
    expect(install.body.data.install.status).toBe('ACTIVE');

    const localAgentId = install.body.data.agent._id as string;
    const localAgent = await AgentModel.findById(localAgentId).lean();
    expect(localAgent?.workspaceId.toString()).toBe(otherWorkspaceId);
    expect(localAgent?.modelConfig.temperature).toBe(0.2);
    expect(localAgent?.status).toBe('ACTIVE');

    expect(
      await InstalledAgentModel.countDocuments({ workspaceId: new Types.ObjectId(otherWorkspaceId) }),
    ).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'AGENT_LISTING_INSTALLED' })).toBe(1);

    const stats = await request
      .get(`/api/v1/agent-marketplace/agents/${listingId}/stats`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(stats.status).toBe(200);
    expect(stats.body.data.installs.total).toBe(1);
    expect(stats.body.data.installs.active).toBe(1);

    const duplicate = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('AGENT_ALREADY_INSTALLED');
  });
  it('annotates search results with the requesting workspace install state', async () => {
    const { listingId } = await publishPublicAgent(workspaceId, ownerToken);

    const before = await request
      .get('/api/v1/agent-marketplace/agents')
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(before.status).toBe(200);
    const beforeItem = (before.body.data.items as Array<{ _id: string; install: unknown }>).find(
      (item) => item._id === listingId,
    );
    expect(beforeItem).toBeDefined();
    expect(beforeItem?.install).toBeNull();

    const install = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    expect(install.status).toBe(201);
    const localAgentId = install.body.data.agent._id as string;

    const after = await request
      .get('/api/v1/agent-marketplace/agents')
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(after.status).toBe(200);
    const afterItem = (
      after.body.data.items as Array<{ _id: string; install: { status: string; agentId: string } | null }>
    ).find((item) => item._id === listingId);
    expect(afterItem?.install?.status).toBe('ACTIVE');
    expect(afterItem?.install?.agentId).toBe(localAgentId);

    const publisherView = await request
      .get('/api/v1/agent-marketplace/agents')
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    const publisherItem = (publisherView.body.data.items as Array<{ _id: string; install: unknown }>).find(
      (item) => item._id === listingId,
    );
    expect(publisherItem?.install).toBeNull();
  });
  it('blocks installs when the installing workspace disables the AI_AGENT feature', async () => {
    const { listingId } = await publishPublicAgent(workspaceId, ownerToken);
    await AIFeaturePolicyModel.create({
      workspaceId: new Types.ObjectId(otherWorkspaceId),
      feature: 'AI_AGENT',
      enabled: false,
      allowedRoles: [],
    });

    const blocked = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('AGENT_MARKETPLACE_POLICY_BLOCKED');
    expect(await InstalledAgentModel.countDocuments({})).toBe(0);
  });

  it('blocks installs when the installing workspace blocks the agent model', async () => {
    const { listingId } = await publishPublicAgent(workspaceId, ownerToken, {
      modelConfig: { model: 'gpt-4o' },
    });
    await AIModelAccessPolicyModel.create({
      workspaceId: new Types.ObjectId(otherWorkspaceId),
      status: 'ACTIVE',
      blockedModels: ['gpt-4*'],
      allowedModels: [],
      allowedRoles: [],
    });

    const blocked = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('AGENT_MARKETPLACE_POLICY_BLOCKED');
  });

  it('rejects installs that reference unknown tools', async () => {
    const { listingId } = await publishPublicAgent(workspaceId, ownerToken, {
      toolsAllowed: ['calculate', 'not_a_real_tool'],
    });

    const rejected = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('UNKNOWN_TOOL');
  });
});
describe('Phase 12.7 Agent Marketplace - uninstall and versioning', () => {
  async function setupPublished() {
    const agent = await createAgentFor(workspaceId, ownerId, { toolsAllowed: ['calculate'] });
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const listingId = created.body.data._id as string;
    await publishListing(listingId, ownerToken, workspaceId);
    return { agent, listingId };
  }

  it('uninstalls an installed agent and archives the local clone', async () => {
    const { listingId } = await setupPublished();
    const install = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    const localAgentId = install.body.data.agent._id as string;

    const uninstall = await request
      .delete(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(uninstall.status).toBe(200);
    expect(uninstall.body.data.uninstalled).toBe(true);

    const record = await InstalledAgentModel.findOne({
      agentMarketplaceId: new Types.ObjectId(listingId),
      workspaceId: new Types.ObjectId(otherWorkspaceId),
    }).lean();
    expect(record?.status).toBe('UNINSTALLED');
    const localAgent = await AgentModel.findById(localAgentId).lean();
    expect(localAgent?.status).toBe('ARCHIVED');

    const stats = await request
      .get(`/api/v1/agent-marketplace/agents/${listingId}/stats`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(stats.body.data.installs.total).toBe(0);
    expect(stats.body.data.installs.active).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: 'AGENT_LISTING_UNINSTALLED' })).toBe(1);

    const secondUninstall = await request
      .delete(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(secondUninstall.status).toBe(404);
  });
});
describe('Phase 12.7 Agent Marketplace - version history and rollback', () => {
  async function setupPublished() {
    const agent = await createAgentFor(workspaceId, ownerId, { toolsAllowed: ['calculate'] });
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const listingId = created.body.data._id as string;
    await publishListing(listingId, ownerToken, workspaceId);
    return { agent, listingId };
  }

  it('creates a new version on republish, compares versions and rolls back', async () => {
    const { agent, listingId } = await setupPublished();

    await AgentService.getInstance().updateAgent(agent._id.toString(), workspaceId, {
      toolsAllowed: ['calculate', 'json_transform'],
      systemPrompt: 'Updated marketplace prompt for version two.',
    } as never);
    const second = await publishListing(listingId, ownerToken, workspaceId);
    expect(second.status).toBe(200);
    expect(second.body.data.versionCount).toBe(2);

    const compare = await request
      .get(`/api/v1/agent-marketplace/agents/${listingId}/versions/compare?from=1&to=2`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(compare.status).toBe(200);
    expect(compare.body.data.identical).toBe(false);
    expect(compare.body.data.toolsAdded).toContain('json_transform');
    expect(compare.body.data.changedFields).toContain('systemPrompt');

    const rollback = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/rollback`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({ version: 1 });
    expect(rollback.status).toBe(201);
    expect(rollback.body.data.versionNumber).toBe(3);

    const listing = await AgentMarketplaceModel.findById(listingId).lean();
    expect(listing?.versionCount).toBe(3);
    expect(listing?.agentSnapshot?.systemPrompt).not.toContain('version two');

    const versions = await request
      .get(`/api/v1/agent-marketplace/agents/${listingId}/versions`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId);
    expect((versions.body.data as unknown[])).toHaveLength(3);

    expect(await AuditLogModel.countDocuments({ action: 'AGENT_VERSION_CREATED' })).toBe(3);
  });
});
describe('Phase 12.7 Agent Marketplace - reviews and ratings', () => {
  async function setupInstalled() {
    const agent = await createAgentFor(workspaceId, ownerId, { toolsAllowed: ['calculate'] });
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const listingId = created.body.data._id as string;
    await publishListing(listingId, ownerToken, workspaceId);
    await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    return { listingId };
  }

  it('requires an active installation before allowing a review', async () => {
    const agent = await createAgentFor(workspaceId, ownerId);
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const listingId = created.body.data._id as string;
    await publishListing(listingId, ownerToken, workspaceId);

    const blocked = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/reviews`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({ rating: 5 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('REVIEW_REQUIRES_INSTALLATION');
  });
});
describe('Phase 12.7 Agent Marketplace - review lifecycle', () => {
  it('records one review per user and recomputes the aggregate rating', async () => {
    const agent = await createAgentFor(workspaceId, ownerId, { toolsAllowed: ['calculate'] });
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const listingId = created.body.data._id as string;
    await publishListing(listingId, ownerToken, workspaceId);
    await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});

    const first = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/reviews`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({ rating: 5, review: 'Solid automation' });
    expect(first.status).toBe(201);
    expect(first.body.data.rating.average).toBe(5);
    expect(first.body.data.rating.count).toBe(1);

    const updated = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/reviews`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({ rating: 3, review: 'Reconsidered' });
    expect(updated.status).toBe(201);
    expect(updated.body.data.rating.average).toBe(3);
    expect(updated.body.data.rating.count).toBe(1);
    expect(await AgentReviewModel.countDocuments({})).toBe(1);

    const invalid = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/reviews`)
      .set(authHeader(otherEditorToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({ rating: 9 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_RATING');

    const list = await request
      .get(`/api/v1/agent-marketplace/agents/${listingId}/reviews`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);

    expect(await AuditLogModel.countDocuments({ action: 'AGENT_REVIEW_CREATED' })).toBe(2);
  });
});
describe('Phase 12.7 Agent Marketplace - RBAC and workspace isolation', () => {
  it('enforces marketplace RBAC for viewers, editors and owners', async () => {
    const agent = await createAgentFor(workspaceId, ownerId);
    const viewerCreate = await createListingFor(agent._id.toString(), viewerToken, workspaceId);
    expect(viewerCreate.status).toBe(403);

    const editorCreate = await createListingFor(agent._id.toString(), editorToken, workspaceId);
    expect(editorCreate.status).toBe(403);

    const ownerCreate = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    expect(ownerCreate.status).toBe(201);
    const listingId = ownerCreate.body.data._id as string;
    await publishListing(listingId, ownerToken, workspaceId);

    const viewerRead = await request
      .get('/api/v1/agent-marketplace/agents')
      .set(authHeader(viewerToken))
      .set('X-Workspace-Id', workspaceId);
    expect(viewerRead.status).toBe(200);

    const viewerInstall = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(viewerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({});
    expect(viewerInstall.status).toBe(403);

    const editorArchive = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/archive`)
      .set(authHeader(editorToken))
      .set('X-Workspace-Id', workspaceId)
      .send({});
    expect(editorArchive.status).toBe(403);

    const ownerArchive = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/archive`)
      .set(authHeader(ownerToken))
      .set('X-Workspace-Id', workspaceId)
      .send({});
    expect(ownerArchive.status).toBe(200);
    expect(ownerArchive.body.data.status).toBe('ARCHIVED');
  });
});
describe('Phase 12.7 Agent Marketplace - workspace isolation', () => {
  it('hides private listings and drafts from other workspaces', async () => {
    const agent = await createAgentFor(workspaceId, ownerId);
    const created = await createListingFor(agent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PRIVATE',
    });
    const listingId = created.body.data._id as string;
    await publishListing(listingId, ownerToken, workspaceId);

    const foreignDetails = await request
      .get(`/api/v1/agent-marketplace/agents/${listingId}`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    expect(foreignDetails.status).toBe(404);

    const foreignInstall = await request
      .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId)
      .send({});
    expect(foreignInstall.status).toBe(404);

    const draftAgent = await createAgentFor(workspaceId, ownerId);
    const draft = await createListingFor(draftAgent._id.toString(), ownerToken, workspaceId, {
      visibility: 'PUBLIC',
    });
    const draftSearch = await request
      .get('/api/v1/agent-marketplace/agents')
      .set(authHeader(otherOwnerToken))
      .set('X-Workspace-Id', otherWorkspaceId);
    const draftIds = (draftSearch.body.data.items as Array<{ _id: string }>).map((item) => item._id);
    expect(draftIds).not.toContain(draft.body.data._id);
  });
});
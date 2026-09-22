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
import { WorkflowTemplateModel } from '../src/models/WorkflowTemplateModel.js';
import { WorkflowTemplateMarketplaceModel } from '../src/models/WorkflowTemplateMarketplaceModel.js';
import { OnboardingSessionModel } from '../src/models/OnboardingSessionModel.js';
import { AIFeaturePolicyModel, AIPromptPolicyModel } from '../src/models/AIGovernancePolicyModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';
/**
 * Phase 17.5 - Marketplace recommendations: deterministic ranking from recorded
 * signals, governed AI copy and the DENY / approval fallbacks, through the app.
 */

const authConfig = {
  jwtSecret: 'test-jwt-secret-for-marketplace-recommendations-17',
  accessTtl: '15m',
  refreshTtl: '30d',
};

const sampleWorkflow: WorkflowDefinition = {
  nodes: [
    { id: 'trigger', type: 'webhook', config: {} },
    { id: 'logger', type: 'log', config: { message: 'Recommendation workflow ran' } },
  ],
  edges: [{ source: 'trigger', target: 'logger' }],
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let sellerWorkspaceId = '';
let buyerWorkspaceId = '';
let outsiderWorkspaceId = '';
let sellerOwnerId = '';
let buyerOwnerId = '';
let sellerOwnerToken = '';
let buyerOwnerToken = '';
let buyerViewerToken = '';
let outsiderOwnerToken = '';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({ auth: authConfig, authRateLimit: { loginLimit: 1000, refreshLimit: 1000 } }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await Promise.all([
    WorkflowTemplateMarketplaceModel.deleteMany({}),
    WorkflowTemplateModel.deleteMany({}),
    OnboardingSessionModel.deleteMany({}),
    AIFeaturePolicyModel.deleteMany({}),
    AIPromptPolicyModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const sellerOwner = await UserModel.create({ email: `seller-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerOwner = await UserModel.create({ email: `buyer-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerViewer = await UserModel.create({ email: `buyer-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  const outsiderOwner = await UserModel.create({ email: `outsider-owner-${stamp}@test.dev`, passwordHash: 'x' });
  sellerOwnerId = sellerOwner._id.toString();
  buyerOwnerId = buyerOwner._id.toString();
  sellerOwnerToken = signAccessToken(authConfig, { userId: sellerOwnerId, email: sellerOwner.email });
  buyerOwnerToken = signAccessToken(authConfig, { userId: buyerOwnerId, email: buyerOwner.email });
  buyerViewerToken = signAccessToken(authConfig, { userId: buyerViewer._id.toString(), email: buyerViewer.email });
  outsiderOwnerToken = signAccessToken(authConfig, { userId: outsiderOwner._id.toString(), email: outsiderOwner.email });
  const sellerWorkspace = await WorkspaceModel.create({ name: 'Recs Seller', slug: `seller-${stamp}`, ownerId: sellerOwner._id });
  sellerWorkspaceId = sellerWorkspace._id.toString();
  const buyerWorkspace = await WorkspaceModel.create({ name: 'Recs Buyer', slug: `buyer-${stamp}`, ownerId: buyerOwner._id });
  buyerWorkspaceId = buyerWorkspace._id.toString();
  const outsiderWorkspace = await WorkspaceModel.create({ name: 'Recs Outsider', slug: `outsider-${stamp}`, ownerId: outsiderOwner._id });
  outsiderWorkspaceId = outsiderWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [sellerWorkspaceId, sellerOwnerId, 'OWNER'],
    [buyerWorkspaceId, buyerOwnerId, 'OWNER'],
    [buyerWorkspaceId, buyerViewer._id.toString(), 'VIEWER'],
    [outsiderWorkspaceId, outsiderOwner._id.toString(), 'OWNER'],
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
  await OnboardingSessionModel.create({
    workspaceId: new Types.ObjectId(buyerWorkspaceId),
    userId: new Types.ObjectId(buyerOwnerId),
    selectedIndustry: 'healthcare',
  });
}, 60000);
async function publishListing(
  name: string,
  options: { pricingModel?: string; price?: number; industryTags?: string[] } = {},
) {
  const template = await WorkflowTemplateModel.create({
    name,
    description: `${name} for operations teams.`,
    category: 'Operations',
    tags: ['ops'],
    visibility: 'MARKETPLACE',
    status: 'PUBLISHED',
    workspaceId: new Types.ObjectId(sellerWorkspaceId),
    createdBy: new Types.ObjectId(sellerOwnerId),
    publisherId: new Types.ObjectId(sellerOwnerId),
    workflowDefinition: sampleWorkflow,
  });
  const res = await request
    .post('/api/v1/marketplace/workflows/publish')
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({
      templateId: template._id.toString(),
      pricingModel: options.pricingModel ?? 'ONE_TIME_PURCHASE',
      price: options.price ?? 1200,
      listingType: 'INDUSTRY_SOLUTION',
      industryTags: options.industryTags ?? ['healthcare'],
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

function recommendations(token = buyerOwnerToken, workspaceId = buyerWorkspaceId) {
  return request
    .get('/api/v1/marketplace/recommendations')
    .set(authHeader(token))
    .set('X-Workspace-Id', workspaceId);
}
describe('Phase 17.5 recommendation ranking', () => {
  it('ranks marketplace workflows with the recorded industry signal', async () => {
    await publishListing('Healthcare Ops Suite', { price: 1200, industryTags: ['healthcare'] });
    await publishListing('Finance Analytics Suite', { pricingModel: 'FREE', price: 0, industryTags: ['finance'] });

    const res = await recommendations();
    expect(res.status).toBe(200);
    expect(res.body.data.industry).toBe('healthcare');
    expect(res.body.data.workflows.length).toBe(2);
    expect(res.body.data.workflows[0].name).toBe('Healthcare Ops Suite');
    expect(res.body.data.workflows[0].reasons).toContain('Matches your industry (healthcare)');
    expect(res.body.data.agents).toEqual([]);
    expect(Array.isArray(res.body.data.usage)).toBe(true);
  });

  it('scopes recommendations to the calling workspace', async () => {
    await publishListing('Healthcare Ops Suite');
    const mine = await recommendations();
    expect(mine.body.data.industry).toBe('healthcare');
    const other = await recommendations(outsiderOwnerToken, outsiderWorkspaceId);
    expect(other.status).toBe(200);
    expect(other.body.data.industry).toBeNull();
  });

  it('allows workspace viewers to read recommendations', async () => {
    await publishListing('Healthcare Ops Suite');
    const res = await recommendations(buyerViewerToken, buyerWorkspaceId);
    expect(res.status).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await request.get('/api/v1/marketplace/recommendations');
    expect(res.status).toBe(401);
  });
});
describe('Phase 17.5 governed AI copy', () => {
  it('drops AI copy on request while keeping the ranking', async () => {
    await publishListing('Healthcare Ops Suite');
    const res = await request
      .get('/api/v1/marketplace/recommendations?includeAiCopy=false')
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data.aiCopy.status).toBe('UNAVAILABLE');
    expect(res.body.data.aiCopy.copy).toBeNull();
    expect(res.body.data.workflows.length).toBeGreaterThan(0);
  });

  it('blocks AI copy under a deny policy without losing the deterministic ranking', async () => {
    await publishListing('Healthcare Ops Suite', { industryTags: ['healthcare'] });
    await AIFeaturePolicyModel.create({
      workspaceId: new Types.ObjectId(buyerWorkspaceId),
      feature: 'AI_AGENT',
      enabled: false,
      allowedRoles: [],
    });

    const res = await recommendations();
    expect(res.status).toBe(200);
    expect(res.body.data.aiCopy.status).toBe('BLOCKED');
    expect(res.body.data.aiCopy.copy).toBeNull();
    expect(res.body.data.aiCopy.reason).toBe('Blocked by AI governance policy');
    expect(res.body.data.workflows.length).toBe(1);
    expect(res.body.data.workflows[0].name).toBe('Healthcare Ops Suite');
    expect(res.body.data.featurePolicy.decision).toBe('DENY');
  });

  it('returns a pending approval instead of copy when a prompt policy requires it', async () => {
    await publishListing('Healthcare Ops Suite');
    await AIPromptPolicyModel.create({
      workspaceId: new Types.ObjectId(buyerWorkspaceId),
      blockedPatterns: [],
      requiredApprovalPatterns: ['marketplace'],
      severity: 'MEDIUM',
    });

    const res = await recommendations();
    expect(res.status).toBe(200);
    expect(res.body.data.aiCopy.status).toBe('PENDING_APPROVAL');
    expect(typeof res.body.data.aiCopy.approvalId).toBe('string');
    expect(res.body.data.aiCopy.copy).toBeNull();
    expect(res.body.data.workflows.length).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'AI_GOVERNANCE_APPROVAL_REQUIRED' })).toBe(1);
  });
});
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
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { AgentMarketplaceModel } from '../src/models/AgentMarketplaceModel.js';
import { AgentModel } from '../src/models/AgentModel.js';
import { MarketplaceLicenseModel } from '../src/models/MarketplaceLicenseModel.js';
import { MarketplaceReviewModel } from '../src/models/MarketplaceReviewModel.js';
import { RevenueTransactionModel } from '../src/models/RevenueTransactionModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { WorkflowTemplateModel } from '../src/models/WorkflowTemplateModel.js';
import { AgentService } from '../src/services/agent/agentService.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';
import { createBillingProvider } from '../src/services/billing/billingProviderRegistry.js';
/**
 * Phase 17.7 - Marketplace reviews and trust through the app: verified purchase
 * gating, one review per workspace, abuse hiding and platform moderation.
 */

const authConfig = {
  jwtSecret: 'test-jwt-secret-for-marketplace-reviews-17',
  accessTtl: '15m',
  refreshTtl: '30d',
};
const PLATFORM_ADMIN_EMAIL = 'reviews-admin@platform.test';

const sampleWorkflow: WorkflowDefinition = {
  nodes: [
    { id: 'trigger', type: 'webhook', config: {} },
    { id: 'logger', type: 'log', config: { message: 'Review workflow ran' } },
  ],
  edges: [{ source: 'trigger', target: 'logger' }],
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let sellerWorkspaceId = '';
let buyerWorkspaceId = '';
let outsiderWorkspaceId = '';
let reviewerWorkspaceId = '';
let sellerOwnerId = '';
let buyerOwnerId = '';
let reportUserIds: string[] = [];
let reportTokens: string[] = [];
let sellerOwnerToken = '';
let buyerOwnerToken = '';
let outsiderOwnerToken = '';
let adminToken = '';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedSubscription(workspaceId: string, label: string) {
  const provider = createBillingProvider('mock');
  const customer = await provider.createCustomer({ email: `${label}@reviews.test`, name: label });
  await SubscriptionModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    plan: 'FREE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: customer.id,
    externalSubscriptionId: `sub_${label}`,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}
beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_EMAIL;
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
    AgentMarketplaceModel.deleteMany({}),
    AgentModel.deleteMany({}),
    MarketplaceLicenseModel.deleteMany({}),
    MarketplaceReviewModel.deleteMany({}),
    RevenueTransactionModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const sellerOwner = await UserModel.create({ email: `seller-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerOwner = await UserModel.create({ email: `buyer-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const outsiderOwner = await UserModel.create({ email: `outsider-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const admin = await UserModel.create({ email: PLATFORM_ADMIN_EMAIL, passwordHash: 'x' });
  const reportUsers = await Promise.all([0, 1, 2].map(async (index) => UserModel.create({
    email: `reporter-${index}-${stamp}@test.dev`,
    passwordHash: 'x',
  })));
  sellerOwnerId = sellerOwner._id.toString();
  buyerOwnerId = buyerOwner._id.toString();
  reportUserIds = reportUsers.map((user) => user._id.toString());
  sellerOwnerToken = signAccessToken(authConfig, { userId: sellerOwnerId, email: sellerOwner.email });
  buyerOwnerToken = signAccessToken(authConfig, { userId: buyerOwnerId, email: buyerOwner.email });
  outsiderOwnerToken = signAccessToken(authConfig, { userId: outsiderOwner._id.toString(), email: outsiderOwner.email });
  adminToken = signAccessToken(authConfig, { userId: admin._id.toString(), email: admin.email });  reportTokens = reportUsers.map((user) => signAccessToken(authConfig, { userId: user._id.toString(), email: user.email }));
  const sellerWorkspace = await WorkspaceModel.create({ name: 'Reviews Seller', slug: `seller-${stamp}`, ownerId: sellerOwner._id });
  sellerWorkspaceId = sellerWorkspace._id.toString();
  const buyerWorkspace = await WorkspaceModel.create({ name: 'Reviews Buyer', slug: `buyer-${stamp}`, ownerId: buyerOwner._id });
  buyerWorkspaceId = buyerWorkspace._id.toString();
  const outsiderWorkspace = await WorkspaceModel.create({ name: 'Reviews Outsider', slug: `outsider-${stamp}`, ownerId: outsiderOwner._id });
  outsiderWorkspaceId = outsiderWorkspace._id.toString();
  const reviewerWorkspace = await WorkspaceModel.create({ name: 'Reviews Reporters', slug: `reporters-${stamp}`, ownerId: reportUsers[0]!._id });
  reviewerWorkspaceId = reviewerWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [sellerWorkspaceId, sellerOwnerId, 'OWNER'],
    [buyerWorkspaceId, buyerOwnerId, 'OWNER'],
    [outsiderWorkspaceId, outsiderOwner._id.toString(), 'OWNER'],
    [reviewerWorkspaceId, reportUsers[0]!._id.toString(), 'OWNER'],
    [reviewerWorkspaceId, reportUsers[1]!._id.toString(), 'EDITOR'],
    [reviewerWorkspaceId, reportUsers[2]!._id.toString(), 'VIEWER'],
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
  await seedSubscription(sellerWorkspaceId, 'seller');
  await seedSubscription(buyerWorkspaceId, 'buyer');
}, 60000);
function createReview(body: Record<string, unknown>, token = buyerOwnerToken, workspaceId = buyerWorkspaceId) {
  return request
    .post('/api/v1/marketplace/reviews')
    .set(authHeader(token))
    .set('X-Workspace-Id', workspaceId)
    .send(body);
}

function listAgentReviews(assetId: string, token = buyerOwnerToken, workspaceId = buyerWorkspaceId) {
  return request
    .get(`/api/v1/marketplace/reviews?assetType=AGENT&assetId=${assetId}`)
    .set(authHeader(token))
    .set('X-Workspace-Id', workspaceId);
}

async function sellAgentListing(paymentId: string) {
  const agent = await AgentService.getInstance().createAgent(sellerWorkspaceId, sellerOwnerId, {
    name: `Reviewable Agent ${new Types.ObjectId().toHexString().slice(-6)}`,
    systemPrompt: 'Summarise incidents and propose remediation steps.',
    toolsAllowed: ['calculate'],
  } as never);
  const created = await request
    .post('/api/v1/agent-marketplace/agents')
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({ agentId: agent._id.toString(), visibility: 'PUBLIC' });
  const listingId = created.body.data._id as string;
  await request
    .post(`/api/v1/agent-marketplace/agents/${listingId}/publish`)
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({});
  await request
    .put(`/api/v1/marketplace/agents/${listingId}/pricing`)
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({ pricingModel: 'ONE_TIME_PURCHASE', price: 10000 });
  const settled = await request
    .post(`/api/v1/marketplace/agents/${listingId}/purchase`)
    .set(authHeader(buyerOwnerToken))
    .set('X-Workspace-Id', buyerWorkspaceId)
    .send({ paymentId });
  expect(settled.body.data.settled).toBe(true);
  return listingId;
}
describe('Phase 17.7 creating reviews', () => {
  it('creates a verified review after a purchase and rejects duplicates', async () => {
    const listingId = await sellAgentListing('pi_review_1');
    const created = await createReview({ assetType: 'AGENT', assetId: listingId, rating: 5, review: 'Excellent agent' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      assetType: 'AGENT',
      assetId: listingId,
      workspaceId: buyerWorkspaceId,
      rating: 5,
      review: 'Excellent agent',
      verifiedPurchase: true,
      status: 'PUBLISHED',
    });

    const duplicate = await createReview({ assetType: 'AGENT', assetId: listingId, rating: 4 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_REVIEW_CREATED' })).toBe(1);
  });

  it('refuses reviews without a purchase and invalid ratings', async () => {
    const listingId = await sellAgentListing('pi_review_2');
    const unverified = await createReview(
      { assetType: 'AGENT', assetId: listingId, rating: 5 },
      outsiderOwnerToken,
      outsiderWorkspaceId,
    );
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('REVIEW_NOT_ALLOWED');

    const invalid = await createReview({ assetType: 'AGENT', assetId: listingId, rating: 9 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_REQUEST');

    const anonymous = await request
      .post('/api/v1/marketplace/reviews')
      .send({ assetType: 'AGENT', assetId: listingId, rating: 5 });
    expect(anonymous.status).toBe(401);
  });
});
describe('Phase 17.7 listing reviews', () => {
  it('lists published reviews with the rating summary', async () => {
    const listingId = await sellAgentListing('pi_review_list');
    await createReview({ assetType: 'AGENT', assetId: listingId, rating: 5, review: 'Great' });

    const res = await listAgentReviews(listingId);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.summary).toMatchObject({ average: 5, count: 1 });
    expect(res.body.data.summary.distribution).toMatchObject({ 1: 0, 5: 1 });
    expect(res.body.data.items[0]).toMatchObject({ rating: 5, review: 'Great', verifiedPurchase: true });

    const missingFilter = await request
      .get('/api/v1/marketplace/reviews')
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(missingFilter.status).toBe(400);
    expect(missingFilter.body.error.code).toBe('INVALID_REQUEST');
  });
});
describe('Phase 17.7 abuse handling', () => {
  it('hides a review at the report threshold and restores it through moderation', async () => {
    const listingId = await sellAgentListing('pi_review_abuse');
    const created = await createReview({ assetType: 'AGENT', assetId: listingId, rating: 5, review: 'Controversial' });
    const reviewId = created.body.data.reviewId as string;

    let lastReport: { status: number; body: { data: { reports: number; status: string } } } | null = null;
    for (const token of reportTokens) {
      const report = await request
        .post(`/api/v1/marketplace/reviews/${reviewId}/report`)
        .set(authHeader(token))
        .set('X-Workspace-Id', reviewerWorkspaceId)
        .send({});
      expect(report.status).toBe(200);
      lastReport = report;
    }
    expect(lastReport?.body.data.reports).toBe(3);
    expect(lastReport?.body.data.status).toBe('HIDDEN');

    const hidden = await listAgentReviews(listingId);
    expect(hidden.body.data.total).toBe(0);
    const row = await MarketplaceReviewModel.findById(reviewId).lean();
    expect(row?.status).toBe('HIDDEN');
    expect(row?.hiddenReason).toBe('Reported by multiple buyers');
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_REVIEW_HIDDEN' })).toBe(1);

    const restored = await request
      .post(`/api/v1/marketplace/reviews/${reviewId}/moderate`)
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', reviewerWorkspaceId)
      .send({ status: 'PUBLISHED' });
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe('PUBLISHED');

    const visible = await listAgentReviews(listingId);
    expect(visible.body.data.total).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_REVIEW_HIDDEN' })).toBe(2);
  });
});
describe('Phase 17.7 moderation RBAC', () => {
  it('reserves moderation for platform administrators', async () => {
    const listingId = await sellAgentListing('pi_review_mod');
    const created = await createReview({ assetType: 'AGENT', assetId: listingId, rating: 4 });
    const denied = await request
      .post(`/api/v1/marketplace/reviews/${created.body.data.reviewId}/moderate`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId)
      .send({ status: 'HIDDEN' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('reviews a purchased workflow template through the same endpoint', async () => {
    const template = await WorkflowTemplateModel.create({
      name: 'Reviewable Premium Workflow',
      description: 'Workflow used by the review suite.',
      category: 'Operations',
      tags: ['ops'],
      visibility: 'MARKETPLACE',
      status: 'PUBLISHED',
      workspaceId: new Types.ObjectId(sellerWorkspaceId),
      createdBy: new Types.ObjectId(sellerOwnerId),
      publisherId: new Types.ObjectId(sellerOwnerId),
      workflowDefinition: sampleWorkflow,
    });
    const published = await request
      .post('/api/v1/marketplace/workflows/publish')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ templateId: template._id.toString(), pricingModel: 'ONE_TIME_PURCHASE', price: 3000 });
    const listingId = published.body.data._id as string;
    const installed = await request
      .post(`/api/v1/marketplace/workflows/${listingId}/install`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId)
      .send({ paymentId: 'pi_review_workflow' });
    expect(installed.status).toBe(201);

    const review = await createReview({
      assetType: 'WORKFLOW',
      assetId: template._id.toString(),
      rating: 4,
      review: 'Solid automation pack',
    });
    expect(review.status).toBe(201);
    expect(review.body.data).toMatchObject({ assetType: 'WORKFLOW', verifiedPurchase: true });

    const listed = await request
      .get(`/api/v1/marketplace/reviews?assetType=WORKFLOW&assetId=${template._id.toString()}`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(listed.body.data.total).toBe(1);
  });
});
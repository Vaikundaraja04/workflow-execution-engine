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
import { WorkflowTemplateModel } from '../src/models/WorkflowTemplateModel.js';
import { WorkflowTemplateMarketplaceModel } from '../src/models/WorkflowTemplateMarketplaceModel.js';
import { AgentMarketplaceModel } from '../src/models/AgentMarketplaceModel.js';
import { MarketplacePricingModel } from '../src/models/MarketplacePricingModel.js';
import { MarketplaceReviewModel } from '../src/models/MarketplaceReviewModel.js';
import { RevenueTransactionModel } from '../src/models/RevenueTransactionModel.js';
import { AgentModel } from '../src/models/AgentModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { AgentService } from '../src/services/agent/agentService.js';
import { createBillingProvider } from '../src/services/billing/billingProviderRegistry.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';
/**
 * Phase 17.4 - Publisher portal: one workspace portfolio folded from listings,
 * the revenue ledger, licenses and published reviews, through the app.
 */

const authConfig = {
  jwtSecret: 'test-jwt-secret-for-publisher-portal-17',
  accessTtl: '15m',
  refreshTtl: '30d',
};

const sampleWorkflow: WorkflowDefinition = {
  nodes: [
    { id: 'trigger', type: 'webhook', config: {} },
    { id: 'logger', type: 'log', config: { message: 'Portal workflow ran' } },
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
let sellerViewerToken = '';
let buyerOwnerToken = '';
let outsiderOwnerToken = '';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
async function seedSubscription(workspaceId: string, label: string) {
  const provider = createBillingProvider('mock');
  const customer = await provider.createCustomer({ email: `${label}@portal.test`, name: label });
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
    AgentMarketplaceModel.deleteMany({}),
    MarketplacePricingModel.deleteMany({}),
    MarketplaceReviewModel.deleteMany({}),
    RevenueTransactionModel.deleteMany({}),
    AgentModel.deleteMany({}),
    WorkflowModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);  const stamp = new Types.ObjectId().toString();
  const sellerOwner = await UserModel.create({ email: `seller-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const sellerViewer = await UserModel.create({ email: `seller-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerOwner = await UserModel.create({ email: `buyer-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const outsiderOwner = await UserModel.create({ email: `outsider-owner-${stamp}@test.dev`, passwordHash: 'x' });
  sellerOwnerId = sellerOwner._id.toString();
  buyerOwnerId = buyerOwner._id.toString();
  sellerOwnerToken = signAccessToken(authConfig, { userId: sellerOwnerId, email: sellerOwner.email });
  sellerViewerToken = signAccessToken(authConfig, { userId: sellerViewer._id.toString(), email: sellerViewer.email });
  buyerOwnerToken = signAccessToken(authConfig, { userId: buyerOwnerId, email: buyerOwner.email });
  outsiderOwnerToken = signAccessToken(authConfig, { userId: outsiderOwner._id.toString(), email: outsiderOwner.email });

  const sellerWorkspace = await WorkspaceModel.create({ name: 'Portal Seller', slug: `seller-${stamp}`, ownerId: sellerOwner._id });
  sellerWorkspaceId = sellerWorkspace._id.toString();
  const buyerWorkspace = await WorkspaceModel.create({ name: 'Portal Buyer', slug: `buyer-${stamp}`, ownerId: buyerOwner._id });
  buyerWorkspaceId = buyerWorkspace._id.toString();
  const outsiderWorkspace = await WorkspaceModel.create({ name: 'Portal Outsider', slug: `outsider-${stamp}`, ownerId: outsiderOwner._id });
  outsiderWorkspaceId = outsiderWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [sellerWorkspaceId, sellerOwnerId, 'OWNER'],
    [sellerWorkspaceId, sellerViewer._id.toString(), 'VIEWER'],
    [buyerWorkspaceId, buyerOwnerId, 'OWNER'],
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
  await seedSubscription(sellerWorkspaceId, 'seller');
  await seedSubscription(buyerWorkspaceId, 'buyer');
}, 60000);
function publishWorkflow(body: Record<string, unknown>) {
  return request
    .post('/api/v1/marketplace/workflows/publish')
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send(body);
}

function sellerDashboard(query = '') {
  return request
    .get(`/api/v1/marketplace/publisher/dashboard${query}`)
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId);
}

async function sellAgentListing(paymentId: string) {
  const agent = await AgentService.getInstance().createAgent(sellerWorkspaceId, sellerOwnerId, {
    name: `Portal Agent ${new Types.ObjectId().toHexString().slice(-6)}`,
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
  return { listingId, transactionId: settled.body.data.transactionId as string };
}
async function sellWorkflowTemplate(paymentId: string) {
  const template = await WorkflowTemplateModel.create({
    name: 'Portal Premium Workflow',
    description: 'Portal test workflow.',
    category: 'Operations',
    tags: ['ops'],
    visibility: 'MARKETPLACE',
    status: 'PUBLISHED',
    workspaceId: new Types.ObjectId(sellerWorkspaceId),
    createdBy: new Types.ObjectId(sellerOwnerId),
    publisherId: new Types.ObjectId(sellerOwnerId),
    workflowDefinition: sampleWorkflow,
  });
  const published = await publishWorkflow({
    templateId: template._id.toString(),
    pricingModel: 'ONE_TIME_PURCHASE',
    price: 4000,
    listingType: 'PREMIUM_WORKFLOW',
  });
  expect(published.status).toBe(201);
  const listingId = published.body.data._id as string;
  const installed = await request
    .post(`/api/v1/marketplace/workflows/${listingId}/install`)
    .set(authHeader(buyerOwnerToken))
    .set('X-Workspace-Id', buyerWorkspaceId)
    .send({ paymentId });
  expect(installed.status).toBe(201);
  return { templateId: template._id.toString(), listingId };
}

describe('Phase 17.4 publisher dashboard', () => {
  it('aggregates content, revenue, licenses and ratings for the publishing workspace', async () => {
    const agent = await sellAgentListing('pi_portal_agent');
    const workflow = await sellWorkflowTemplate('pi_portal_wf');
    await AgentMarketplaceModel.updateOne(
      { _id: new Types.ObjectId(agent.listingId) },
      { $set: { rating: { average: 4.5, count: 2 } } },
    );
    await MarketplaceReviewModel.create({
      assetType: 'WORKFLOW',
      assetId: new Types.ObjectId(workflow.templateId),
      workspaceId: new Types.ObjectId(buyerWorkspaceId),
      userId: new Types.ObjectId(buyerOwnerId),
      publisherId: new Types.ObjectId(sellerOwnerId),
      rating: 4,
      review: 'Solid premium workflow',
      verifiedPurchase: true,
      status: 'PUBLISHED',
      abuseReports: [],
    });
    const res = await sellerDashboard();
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.workspaceId).toBe(sellerWorkspaceId);
    expect(data.content).toHaveLength(2);

    const agentItem = data.content.find((item: { assetType: string }) => item.assetType === 'AGENT');
    expect(agentItem).toMatchObject({ pricingModel: 'ONE_TIME_PURCHASE', price: 10000, currency: 'usd', sales: 1, grossRevenue: 2900 });
    const workflowItem = data.content.find((item: { assetType: string }) => item.assetType === 'WORKFLOW');
    expect(workflowItem).toMatchObject({ pricingModel: 'ONE_TIME_PURCHASE', price: 4000, sales: 1, installs: 1 });

    expect(data.revenue.totals.grossSales).toBe(5800);
    expect(data.revenue.totals.publisherEarnings).toBe(4640);
    expect(data.revenue.totals.platformRevenue).toBe(1160);
    expect(data.payouts.available).toBe(4640);
    expect(data.payouts.paidOut).toBe(0);
    expect(data.licenses.active).toBe(2);
    expect(data.licenses.byAssetType).toEqual({ AGENT: 1, WORKFLOW: 1 });
    expect(data.ratings.average).toBe(4.3);
    expect(data.ratings.count).toBe(3);
    expect(data.notes).toEqual([]);
  });
});
describe('Phase 17.4 publisher portfolio isolation', () => {
  it('reports an empty portfolio with explicit notes for a non-publishing workspace', async () => {
    const res = await request
      .get('/api/v1/marketplace/publisher/dashboard')
      .set(authHeader(outsiderOwnerToken))
      .set('X-Workspace-Id', outsiderWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data.content).toEqual([]);
    expect(res.body.data.revenue.totals.transactions).toBe(0);
    expect(res.body.data.licenses.active).toBe(0);
    expect(res.body.data.notes).toContain('No marketplace listings published by this workspace');
    expect(res.body.data.notes).toContain('No sales recorded in this window');
  });

  it('hides another workspace portfolio behind 404', async () => {
    await sellAgentListing('pi_portal_guard');
    const res = await request
      .get('/api/v1/marketplace/publisher/dashboard')
      .set(authHeader(outsiderOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('allows workspace viewers to read their own portfolio', async () => {
    const res = await request
      .get('/api/v1/marketplace/publisher/dashboard')
      .set(authHeader(sellerViewerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data.workspaceId).toBe(sellerWorkspaceId);
  });
});

describe('Phase 17.4 portal windowing', () => {
  it('excludes settlements outside the requested window', async () => {
    const agent = await sellAgentListing('pi_portal_window');
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await RevenueTransactionModel.updateOne(
      { transactionId: agent.transactionId },
      { $set: { settledAt: oldDate } },
    );
    const recent = await sellerDashboard();
    expect(recent.body.data.revenue.totals.transactions).toBe(0);
    expect(recent.body.data.content[0].sales).toBe(0);
    expect(recent.body.data.notes).toContain('No sales recorded in this window');

    const wide = await sellerDashboard('?days=90');
    expect(wide.body.data.revenue.totals.transactions).toBe(1);
    expect(wide.body.data.content[0].sales).toBe(1);
  });
});
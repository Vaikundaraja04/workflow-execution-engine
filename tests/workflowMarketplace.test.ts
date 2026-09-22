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
import { MarketplaceLicenseModel } from '../src/models/MarketplaceLicenseModel.js';
import { RevenueTransactionModel } from '../src/models/RevenueTransactionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { createBillingProvider } from '../src/services/billing/billingProviderRegistry.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';
/**
 * Phase 17.2 - Premium workflow marketplace through the app: publishing
 * templates, browsing, purchase into a license, installs through
 * TemplateService, renewal and the free path.
 */

const authConfig = {
  jwtSecret: 'test-jwt-secret-for-workflow-marketplace-17',
  accessTtl: '15m',
  refreshTtl: '30d',
};

const sampleWorkflow: WorkflowDefinition = {
  nodes: [
    { id: 'trigger', type: 'webhook', config: {} },
    { id: 'logger', type: 'log', config: { message: 'Premium workflow ran' } },
  ],
  edges: [{ source: 'trigger', target: 'logger' }],
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let sellerWorkspaceId = '';
let buyerWorkspaceId = '';
let outsiderWorkspaceId = '';
let sellerOwnerId = '';
let sellerOwnerToken = '';
let sellerViewerToken = '';
let buyerOwnerToken = '';
let buyerViewerToken = '';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedSubscription(workspaceId: string, label: string) {
  const provider = createBillingProvider('mock');
  const customer = await provider.createCustomer({ email: `${label}@workflow.test`, name: label });
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
    MarketplaceLicenseModel.deleteMany({}),
    RevenueTransactionModel.deleteMany({}),
    WorkflowModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const sellerOwner = await UserModel.create({ email: `seller-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const sellerViewer = await UserModel.create({ email: `seller-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerOwner = await UserModel.create({ email: `buyer-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerViewer = await UserModel.create({ email: `buyer-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  const outsiderOwner = await UserModel.create({ email: `outsider-owner-${stamp}@test.dev`, passwordHash: 'x' });
  sellerOwnerId = sellerOwner._id.toString();
  sellerOwnerToken = signAccessToken(authConfig, { userId: sellerOwnerId, email: sellerOwner.email });
  sellerViewerToken = signAccessToken(authConfig, { userId: sellerViewer._id.toString(), email: sellerViewer.email });
  buyerOwnerToken = signAccessToken(authConfig, { userId: buyerOwner._id.toString(), email: buyerOwner.email });
  buyerViewerToken = signAccessToken(authConfig, { userId: buyerViewer._id.toString(), email: buyerViewer.email });
  const sellerWorkspace = await WorkspaceModel.create({ name: 'Template Seller', slug: `seller-${stamp}`, ownerId: sellerOwner._id });
  sellerWorkspaceId = sellerWorkspace._id.toString();
  const buyerWorkspace = await WorkspaceModel.create({ name: 'Template Buyer', slug: `buyer-${stamp}`, ownerId: buyerOwner._id });
  buyerWorkspaceId = buyerWorkspace._id.toString();
  const outsiderWorkspace = await WorkspaceModel.create({ name: 'Template Outsider', slug: `outsider-${stamp}`, ownerId: outsiderOwner._id });
  outsiderWorkspaceId = outsiderWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [sellerWorkspaceId, sellerOwnerId, 'OWNER'],
    [sellerWorkspaceId, sellerViewer._id.toString(), 'VIEWER'],
    [buyerWorkspaceId, buyerOwner._id.toString(), 'OWNER'],
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
  await seedSubscription(sellerWorkspaceId, 'seller');
  await seedSubscription(buyerWorkspaceId, 'buyer');
}, 60000);

async function createTemplate(workspaceId: string, name: string) {
  const template = await WorkflowTemplateModel.create({
    name,
    description: 'Industry solution for operations teams.',
    category: 'Operations',
    tags: ['ops'],
    visibility: 'MARKETPLACE',
    status: 'PUBLISHED',
    workspaceId: new Types.ObjectId(workspaceId),
    createdBy: new Types.ObjectId(sellerOwnerId),
    publisherId: new Types.ObjectId(sellerOwnerId),
    workflowDefinition: sampleWorkflow,
  });
  return template._id.toString();
}
function publishWorkflow(body: Record<string, unknown>, token = sellerOwnerToken) {
  return request
    .post('/api/v1/marketplace/workflows/publish')
    .set(authHeader(token))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send(body);
}

function installWorkflow(listingId: string, token: string, workspaceId: string, body: Record<string, unknown> = {}) {
  return request
    .post(`/api/v1/marketplace/workflows/${listingId}/install`)
    .set(authHeader(token))
    .set('X-Workspace-Id', workspaceId)
    .send(body);
}

describe('Phase 17.2 publishing premium workflows', () => {
  it('publishes a premium workflow with pricing and bumps the marketplace version', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Premium Incident Response');
    const created = await publishWorkflow({
      templateId,
      listingType: 'PREMIUM_WORKFLOW',
      pricingModel: 'ONE_TIME_PURCHASE',
      price: 5000,
      industryTags: ['operations'],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      templateId,
      listingType: 'PREMIUM_WORKFLOW',
      pricingModel: 'ONE_TIME_PURCHASE',
      price: 5000,
      status: 'PUBLISHED',
      marketplaceVersion: 1,
      revenueSharePercentage: 80,
    });
    expect(await AuditLogModel.countDocuments({ action: 'WORKFLOW_MARKETPLACE_PUBLISHED' })).toBe(1);

    const updated = await publishWorkflow({ templateId, pricingModel: 'ONE_TIME_PURCHASE', price: 7500 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.marketplaceVersion).toBe(2);
    expect(updated.body.data.price).toBe(7500);
    expect(await WorkflowTemplateMarketplaceModel.countDocuments({})).toBe(1);
  });
});
describe('Phase 17.2 listing validation and RBAC', () => {
  it('validates the listing shape and template ownership', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Validation Template');
    const noPrice = await publishWorkflow({ templateId, pricingModel: 'ONE_TIME_PURCHASE' });
    expect(noPrice.status).toBe(400);
    expect(noPrice.body.error.code).toBe('INVALID_PRICING');

    const emptyBundle = await publishWorkflow({ templateId, pricingModel: 'FREE', listingType: 'BUNDLE' });
    expect(emptyBundle.status).toBe(400);
    expect(emptyBundle.body.error.code).toBe('INVALID_WORKFLOW_LISTING');

    const untagged = await publishWorkflow({ templateId, pricingModel: 'FREE', listingType: 'INDUSTRY_SOLUTION' });
    expect(untagged.status).toBe(400);
    expect(untagged.body.error.code).toBe('INVALID_WORKFLOW_LISTING');

    const foreignTemplate = await createTemplate(outsiderWorkspaceId, 'Foreign Template');
    const foreign = await publishWorkflow({ templateId: foreignTemplate, pricingModel: 'FREE' });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('WORKFLOW_TEMPLATE_NOT_FOUND');
  });

  it('denies publishing to viewers', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Viewer Blocked Template');
    const res = await publishWorkflow({ templateId, pricingModel: 'FREE' }, sellerViewerToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await WorkflowTemplateMarketplaceModel.countDocuments({})).toBe(0);
  });
});
describe('Phase 17.2 browsing the workflow marketplace', () => {
  it('lists published listings with pricing and template details, filtered by industry', async () => {
    const opsTemplate = await createTemplate(sellerWorkspaceId, 'Operations Suite');
    await publishWorkflow({ templateId: opsTemplate, pricingModel: 'ONE_TIME_PURCHASE', price: 4000, listingType: 'INDUSTRY_SOLUTION', industryTags: ['operations'] });
    const otherTemplate = await createTemplate(sellerWorkspaceId, 'Finance Suite');
    await publishWorkflow({ templateId: otherTemplate, pricingModel: 'FREE', listingType: 'PREMIUM_WORKFLOW', industryTags: ['finance'] });

    const all = await request
      .get('/api/v1/marketplace/workflows')
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(2);
    expect(all.body.data.items.map((item: { name: string }) => item.name)).toContain('Operations Suite');

    const filtered = await request
      .get('/api/v1/marketplace/workflows?industryTags=finance')
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].name).toBe('Finance Suite');
  });

  it('returns details with the caller license state and hides unknown listings', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Details Template');
    const published = await publishWorkflow({ templateId, pricingModel: 'ONE_TIME_PURCHASE', price: 2500 });

    const details = await request
      .get(`/api/v1/marketplace/workflows/${published.body.data._id}`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(details.status).toBe(200);
    expect(details.body.data.template.name).toBe('Details Template');
    expect(details.body.data.license).toBeNull();

    const missing = await request
      .get(`/api/v1/marketplace/workflows/${new Types.ObjectId().toString()}`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('WORKFLOW_LISTING_NOT_FOUND');
  });
});
describe('Phase 17.2 purchase, license and install', () => {
  it('blocks paid installs without a license and settles a purchase through install', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Paid Install Template');
    const published = await publishWorkflow({ templateId, pricingModel: 'ONE_TIME_PURCHASE', price: 5000 });
    const listingId = published.body.data._id as string;

    const blocked = await installWorkflow(listingId, buyerOwnerToken, buyerWorkspaceId);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LICENSE_REQUIRED');

    const session = await request
      .post(`/api/v1/marketplace/workflows/${listingId}/purchase`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId)
      .send({});
    expect(session.status).toBe(201);
    expect(session.body.data).toMatchObject({ amount: 5000, provider: 'mock', templateName: 'Paid Install Template' });

    const installed = await installWorkflow(listingId, buyerOwnerToken, buyerWorkspaceId, {
      paymentId: 'pi_workflow_install_1',
      workflowName: 'Installed Premium Flow',
    });
    expect(installed.status).toBe(201);
    expect(installed.body.data.license.status).toBe('ACTIVE');

    const license = await MarketplaceLicenseModel.findOne({ workspaceId: new Types.ObjectId(buyerWorkspaceId) });
    expect(license?.status).toBe('ACTIVE');
    expect(license?.assetType).toBe('WORKFLOW');

    const workflow = await WorkflowModel.findOne({ workspaceId: new Types.ObjectId(buyerWorkspaceId) }).lean();
    expect(workflow?.name).toBe('Installed Premium Flow');

    const transaction = await RevenueTransactionModel.findOne({ assetType: 'WORKFLOW' }).lean();
    expect(transaction?.amount).toBe(2900);
    expect(transaction?.platformCommission).toBe(580);
    expect(transaction?.publisherEarnings).toBe(2320);

    const listing = await WorkflowTemplateMarketplaceModel.findById(listingId).lean();
    expect(listing?.statistics.sales).toBe(1);
    expect(listing?.statistics.installs).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_WORKFLOW_INSTALLED' })).toBe(1);
  });
});
describe('Phase 17.2 free installs', () => {
  it('installs a free listing without a purchase and reuses the license afterwards', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Free Operations Template');
    const published = await publishWorkflow({ templateId, pricingModel: 'FREE', listingType: 'PREMIUM_WORKFLOW' });
    const listingId = published.body.data._id as string;

    const installed = await installWorkflow(listingId, buyerViewerToken, buyerWorkspaceId, { workflowName: 'Free Copy' });
    expect(installed.status).toBe(201);
    expect(installed.body.data.license.status).toBe('ACTIVE');

    const again = await installWorkflow(listingId, buyerOwnerToken, buyerWorkspaceId, { workflowName: 'Second Copy' });
    expect(again.status).toBe(201);
    expect(await MarketplaceLicenseModel.countDocuments({})).toBe(1);
    expect(await WorkflowModel.countDocuments({ workspaceId: new Types.ObjectId(buyerWorkspaceId) })).toBe(2);
  });
});
describe('Phase 17.2 renewal and self purchase', () => {
  it('renews a workflow subscription after a settled payment', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Renewable Template');
    const published = await publishWorkflow({ templateId, pricingModel: 'SUBSCRIPTION', price: 500, billingCycle: 'MONTHLY' });
    const listingId = published.body.data._id as string;

    const first = await installWorkflow(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_wf_sub_1' });
    expect(first.status).toBe(201);
    const before = new Date(first.body.data.license.expiresAt as string).getTime();

    const renewed = await request
      .post(`/api/v1/marketplace/workflows/${listingId}/renew`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId)
      .send({ paymentId: 'pi_wf_sub_renew_1' });
    expect(renewed.status).toBe(200);
    const after = new Date(renewed.body.data.license.expiresAt as string).getTime();
    expect(after).toBeGreaterThan(before);
    expect(renewed.body.data.license.lastRenewedAt).toBeTruthy();
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_LICENSE_RENEWED' })).toBe(1);
  });

  it('rejects buying the publisher own workflow', async () => {
    const templateId = await createTemplate(sellerWorkspaceId, 'Self Purchase Template');
    const published = await publishWorkflow({ templateId, pricingModel: 'ONE_TIME_PURCHASE', price: 1500 });
    const res = await request
      .post(`/api/v1/marketplace/workflows/${published.body.data._id}/purchase`)
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PURCHASE');
  });
});
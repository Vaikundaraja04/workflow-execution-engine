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
import { InstalledAgentModel } from '../src/models/InstalledAgentModel.js';
import { AgentModel } from '../src/models/AgentModel.js';
import { MarketplacePricingModel } from '../src/models/MarketplacePricingModel.js';
import { MarketplaceLicenseModel } from '../src/models/MarketplaceLicenseModel.js';
import { RevenueTransactionModel } from '../src/models/RevenueTransactionModel.js';
import { PaymentRecordModel } from '../src/models/PaymentRecordModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { AgentService } from '../src/services/agent/agentService.js';
import { createBillingProvider } from '../src/services/billing/billingProviderRegistry.js';
/**
 * Phase 17.1 - Agent marketplace monetization through the real app: pricing
 * records, provider purchase sessions, settlement into licenses and the revenue
 * ledger, renewal, revocation and the paid-install gate.
 */

const authConfig = {
  jwtSecret: 'test-jwt-secret-for-marketplace-billing-17',
  accessTtl: '15m',
  refreshTtl: '30d',
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
let buyerEditorToken = '';
let outsiderOwnerToken = '';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedSubscription(workspaceId: string, label: string) {
  const provider = createBillingProvider('mock');
  const customer = await provider.createCustomer({ email: `${label}@marketplace.test`, name: label });
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
    AgentMarketplaceModel.deleteMany({}),
    InstalledAgentModel.deleteMany({}),
    AgentModel.deleteMany({}),
    MarketplacePricingModel.deleteMany({}),
    MarketplaceLicenseModel.deleteMany({}),
    RevenueTransactionModel.deleteMany({}),
    PaymentRecordModel.deleteMany({}),
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
  const buyerEditor = await UserModel.create({ email: `buyer-editor-${stamp}@test.dev`, passwordHash: 'x' });
  const outsiderOwner = await UserModel.create({ email: `outsider-owner-${stamp}@test.dev`, passwordHash: 'x' });
  sellerOwnerId = sellerOwner._id.toString();
  buyerOwnerId = buyerOwner._id.toString();
  sellerOwnerToken = signAccessToken(authConfig, { userId: sellerOwnerId, email: sellerOwner.email });
  sellerViewerToken = signAccessToken(authConfig, { userId: sellerViewer._id.toString(), email: sellerViewer.email });
  buyerOwnerToken = signAccessToken(authConfig, { userId: buyerOwnerId, email: buyerOwner.email });
  buyerEditorToken = signAccessToken(authConfig, { userId: buyerEditor._id.toString(), email: buyerEditor.email });
  outsiderOwnerToken = signAccessToken(authConfig, { userId: outsiderOwner._id.toString(), email: outsiderOwner.email });
  const sellerWorkspace = await WorkspaceModel.create({ name: 'Seller WS', slug: `seller-${stamp}`, ownerId: sellerOwner._id });
  sellerWorkspaceId = sellerWorkspace._id.toString();
  const buyerWorkspace = await WorkspaceModel.create({ name: 'Buyer WS', slug: `buyer-${stamp}`, ownerId: buyerOwner._id });
  buyerWorkspaceId = buyerWorkspace._id.toString();
  const outsiderWorkspace = await WorkspaceModel.create({ name: 'Outsider WS', slug: `outsider-${stamp}`, ownerId: outsiderOwner._id });
  outsiderWorkspaceId = outsiderWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [sellerWorkspaceId, sellerOwnerId, 'OWNER'],
    [sellerWorkspaceId, sellerViewer._id.toString(), 'VIEWER'],
    [buyerWorkspaceId, buyerOwnerId, 'OWNER'],
    [buyerWorkspaceId, buyerEditor._id.toString(), 'EDITOR'],
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

async function createPublishedListing() {
  const agent = await AgentService.getInstance().createAgent(sellerWorkspaceId, sellerOwnerId, {
    name: `Billing Agent ${new Types.ObjectId().toHexString().slice(-6)}`,
    systemPrompt: 'Summarise incidents and propose remediation steps.',
    toolsAllowed: ['calculate'],
  } as never);
  const created = await request
    .post('/api/v1/agent-marketplace/agents')
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({ agentId: agent._id.toString(), visibility: 'PUBLIC', category: 'Operations' });
  const listingId = created.body.data._id as string;
  const published = await request
    .post(`/api/v1/agent-marketplace/agents/${listingId}/publish`)
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({});
  expect(published.status).toBe(200);
  return listingId;
}
function priceListing(listingId: string, body: Record<string, unknown> = {}) {
  return request
    .put(`/api/v1/marketplace/agents/${listingId}/pricing`)
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({ pricingModel: 'ONE_TIME_PURCHASE', price: 10000, ...body });
}

function purchase(listingId: string, token: string, workspaceId: string, body: Record<string, unknown> = {}) {
  return request
    .post(`/api/v1/marketplace/agents/${listingId}/purchase`)
    .set(authHeader(token))
    .set('X-Workspace-Id', workspaceId)
    .send(body);
}

function installListing(listingId: string, token: string, workspaceId: string) {
  return request
    .post(`/api/v1/agent-marketplace/agents/${listingId}/install`)
    .set(authHeader(token))
    .set('X-Workspace-Id', workspaceId)
    .send({ configuration: {} });
}

describe('Phase 17.1 marketplace pricing', () => {
  it('creates an ACTIVE pricing record with the default publisher share', async () => {
    const listingId = await createPublishedListing();
    const res = await priceListing(listingId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      pricingModel: 'ONE_TIME_PURCHASE',
      price: 10000,
      currency: 'usd',
      billingCycle: 'NONE',
      revenueSharePercentage: 80,
      status: 'ACTIVE',
    });
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_PRICING_UPDATED' })).toBe(1);
  });

  it('rejects paid pricing without a positive price', async () => {
    const listingId = await createPublishedListing();
    const res = await priceListing(listingId, { price: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PRICING');
  });
});
describe('Phase 17.1 pricing isolation and RBAC', () => {
  it('hides pricing changes for listings owned by another workspace', async () => {
    const listingId = await createPublishedListing();
    const res = await request
      .put(`/api/v1/marketplace/agents/${listingId}/pricing`)
      .set(authHeader(outsiderOwnerToken))
      .set('X-Workspace-Id', outsiderWorkspaceId)
      .send({ pricingModel: 'FREE' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LISTING_NOT_FOUND');
    expect(await MarketplacePricingModel.countDocuments({})).toBe(0);
  });

  it('denies pricing to workspace viewers', async () => {
    const listingId = await createPublishedListing();
    const res = await request
      .put(`/api/v1/marketplace/agents/${listingId}/pricing`)
      .set(authHeader(sellerViewerToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ pricingModel: 'FREE' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('reads the pricing record back to any marketplace reader', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId, { currency: 'EUR' });
    const res = await request
      .get(`/api/v1/marketplace/agents/${listingId}/pricing`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ price: 10000, currency: 'eur' });
  });

  it('requires authentication', async () => {
    const listingId = await createPublishedListing();
    const res = await request.put(`/api/v1/marketplace/agents/${listingId}/pricing`).send({ pricingModel: 'FREE' });
    expect(res.status).toBe(401);
  });
});
describe('Phase 17.1 marketplace purchases', () => {
  it('creates a provider payment session for the listing price', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);
    const res = await purchase(listingId, buyerOwnerToken, buyerWorkspaceId);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      listingId,
      pricingModel: 'ONE_TIME_PURCHASE',
      amount: 10000,
      currency: 'usd',
      provider: 'mock',
      status: 'requires_payment_method',
    });
    expect(typeof res.body.data.clientSecret).toBe('string');
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_PURCHASE_STARTED' })).toBe(1);
  });

  it('rejects a purchase of the publisher own listing', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);
    const res = await purchase(listingId, sellerOwnerToken, sellerWorkspaceId);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PURCHASE');
  });

  it('requires an active price before a purchase', async () => {
    const listingId = await createPublishedListing();
    const res = await purchase(listingId, buyerOwnerToken, buyerWorkspaceId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_NOT_SET');
  });
});
describe('Phase 17.1 settlement and licenses', () => {
  it('settles a purchase into a license, payment record and revenue row', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);
    const settled = await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_settled_agent_1' });
    expect(settled.status).toBe(200);
    expect(settled.body.data.settled).toBe(true);
    expect(settled.body.data.license.status).toBe('ACTIVE');

    const license = await MarketplaceLicenseModel.findOne({ workspaceId: new Types.ObjectId(buyerWorkspaceId) });
    expect(license?.status).toBe('ACTIVE');
    expect(license?.paymentId).toBe('pi_settled_agent_1');
    expect(license?.transactionId).toBe(settled.body.data.transactionId);
    expect(license?.revenueSharePercentage).toBe(80);

    const transaction = await RevenueTransactionModel.findOne({ transactionId: settled.body.data.transactionId });
    expect(transaction?.amount).toBe(2900);
    expect(transaction?.platformCommission).toBe(580);
    expect(transaction?.publisherEarnings).toBe(2320);
    expect(transaction?.status).toBe('AVAILABLE');
    expect(transaction?.currency).toBe('usd');

    const payment = await PaymentRecordModel.findOne({ paymentId: 'pi_settled_agent_1' });
    expect(payment?.paid).toBe(true);
    expect(payment?.workspaceId?.toString()).toBe(buyerWorkspaceId);

    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_PURCHASE_COMPLETED' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_LICENSE_ACTIVATED' })).toBe(1);
  });
});
describe('Phase 17.1 settlement edge cases', () => {
  it('refuses a second settlement for an already licensed asset', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);
    await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_settled_agent_1' });
    const again = await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_settled_agent_2' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LICENSE_ALREADY_ACTIVE');
    expect(await RevenueTransactionModel.countDocuments({})).toBe(1);
  });

  it('returns an unsettled result for a payment the provider has not settled', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);
    const session = await purchase(listingId, buyerOwnerToken, buyerWorkspaceId);
    const result = await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, {
      paymentId: session.body.data.paymentId,
    });
    expect(result.status).toBe(200);
    expect(result.body.data.settled).toBe(false);
    expect(result.body.data.reason).toBe('PAYMENT_NOT_SETTLED');
    expect(result.body.data.license).toBeNull();
    expect(await MarketplaceLicenseModel.countDocuments({})).toBe(0);
    expect(await RevenueTransactionModel.countDocuments({})).toBe(0);
  });
});
describe('Phase 17.1 paid install gate', () => {
  it('blocks installs without a license and unlocks them after settlement', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);

    const blocked = await installListing(listingId, buyerEditorToken, buyerWorkspaceId);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LICENSE_REQUIRED');
    expect(await InstalledAgentModel.countDocuments({ workspaceId: new Types.ObjectId(buyerWorkspaceId) })).toBe(0);

    await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_install_1' });

    const installed = await installListing(listingId, buyerEditorToken, buyerWorkspaceId);
    expect(installed.status).toBe(201);
    expect(await InstalledAgentModel.countDocuments({ workspaceId: new Types.ObjectId(buyerWorkspaceId) })).toBe(1);
    expect(await AgentModel.countDocuments({ workspaceId: new Types.ObjectId(buyerWorkspaceId) })).toBe(1);
  });

  it('keeps free listings installable without a purchase', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId, { pricingModel: 'FREE', price: 0 });
    const installed = await installListing(listingId, buyerEditorToken, buyerWorkspaceId);
    expect(installed.status).toBe(201);
  });
});
describe('Phase 17.1 renewal and revocation', () => {
  it('renews a subscription license after a settled payment', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId, { pricingModel: 'SUBSCRIPTION', price: 500, billingCycle: 'MONTHLY' });
    const first = await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_sub_1' });
    expect(first.body.data.license.status).toBe('ACTIVE');
    const before = new Date(first.body.data.license.expiresAt as string).getTime();

    const renewed = await request
      .post(`/api/v1/marketplace/agents/${listingId}/renew`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId)
      .send({ paymentId: 'pi_sub_renew_1' });
    expect(renewed.status).toBe(200);
    const after = new Date(renewed.body.data.license.expiresAt as string).getTime();
    expect(after).toBeGreaterThan(before);
    expect(renewed.body.data.license.lastRenewedAt).toBeTruthy();
    expect(await RevenueTransactionModel.countDocuments({ 'metadata.renewal': true })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_LICENSE_RENEWED' })).toBe(1);
  });

  it('requires a payment for a renewal', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId, { pricingModel: 'SUBSCRIPTION', price: 500, billingCycle: 'MONTHLY' });
    await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_sub_1' });
    const invalid = await request
      .post(`/api/v1/marketplace/agents/${listingId}/renew`)
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId)
      .send({});
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_REQUEST');
  });
});
describe('Phase 17.1 revocation and license listing', () => {
  it('revokes a buyer license from the publisher workspace and re-locks installs', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);
    await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_revoke_1' });

    const denied = await request
      .post(`/api/v1/marketplace/agents/${listingId}/revoke`)
      .set(authHeader(outsiderOwnerToken))
      .set('X-Workspace-Id', outsiderWorkspaceId)
      .send({ buyerWorkspaceId });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('LISTING_NOT_FOUND');

    const revoked = await request
      .post(`/api/v1/marketplace/agents/${listingId}/revoke`)
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ buyerWorkspaceId, reason: 'Chargeback' });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('REVOKED');

    const license = await MarketplaceLicenseModel.findOne({ workspaceId: new Types.ObjectId(buyerWorkspaceId) });
    expect(license?.status).toBe('REVOKED');
    expect(license?.revokeReason).toBe('Chargeback');
    expect(license?.revokedBy?.toString()).toBe(sellerOwnerId);

    const reinstalled = await installListing(listingId, buyerEditorToken, buyerWorkspaceId);
    expect(reinstalled.status).toBe(403);
    expect(reinstalled.body.error.code).toBe('LICENSE_REQUIRED');
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_LICENSE_REVOKED' })).toBe(1);
  });

  it('lists licenses per calling workspace only', async () => {
    const listingId = await createPublishedListing();
    await priceListing(listingId);
    await purchase(listingId, buyerOwnerToken, buyerWorkspaceId, { paymentId: 'pi_list_1' });

    const mine = await request
      .get('/api/v1/marketplace/licenses')
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ assetType: 'AGENT', status: 'ACTIVE' });

    const other = await request
      .get('/api/v1/marketplace/licenses')
      .set(authHeader(outsiderOwnerToken))
      .set('X-Workspace-Id', outsiderWorkspaceId);
    expect(other.status).toBe(200);
    expect(other.body.data).toHaveLength(0);
  });
});